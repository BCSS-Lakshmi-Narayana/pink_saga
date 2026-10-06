const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');

const GeminiResultSchema = z
  .object({
    topic: z.string().optional().nullable(),
    context: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    flags: z.any().optional().nullable(),
    flagged_lines: z
      .array(
        z.object({
          line: z.number().int().positive().optional(),
          text: z.string().optional().nullable(),
          category: z.string().optional().nullable(),
          severity: z.string().optional().nullable(),
          reason: z.string().optional().nullable()
        })
      )
      .optional()
      .nullable()
  })
  .passthrough();

function splitTranscriptIntoLines(transcript) {
  const raw = (transcript || '').trim();
  if (!raw) return [];

  // Sentence-ish split, then wrap long items.
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const lines = [];
  const maxLen = Number(process.env.TRANSCRIPT_LINE_WRAP || 160);
  for (const s of sentences.length ? sentences : [raw]) {
    if (s.length <= maxLen) {
      lines.push(s);
      continue;
    }
    let i = 0;
    while (i < s.length) {
      lines.push(s.slice(i, i + maxLen));
      i += maxLen;
    }
  }
  return lines;
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function analyzeTranscriptWithGemini({
  title,
  youtubeUrl,
  videoId,
  transcript,
  language,
  durationSeconds
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const lines = splitTranscriptIntoLines(transcript);
  const numberedLines = lines.map((l, idx) => `${idx + 1}. ${l}`).join('\n');

  const prompt = [
    'You are an intelligence analyst. Produce STRICT JSON only.',
    'Task:',
    '- Identify what the video is about (topic/context).',
    '- Check whether any lines indicate hate, violence, or other sensitive content (self-harm, harassment, sexual content, extremism, etc).',
    '- Return clear insights for an admin UI and highlight any flagged lines.',
    '',
    'Output JSON schema (keys must exist even if empty):',
    '{',
    '  "topic": string,',
    '  "context": string,',
    '  "summary": string,',
    '  "flags": {',
    '    "hate": {"present": boolean, "severity": "none|low|medium|high", "notes": string},',
    '    "violence": {"present": boolean, "severity": "none|low|medium|high", "notes": string},',
    '    "sensitive": {"present": boolean, "severity": "none|low|medium|high", "notes": string}',
    '  },',
    '  "flagged_lines": [',
    '    {"line": number, "text": string, "category": "hate|violence|sensitive", "severity": "low|medium|high", "reason": string}',
    '  ]',
    '}',
    '',
    'Rules:',
    '- ONLY output JSON. No markdown.',
    '- If no content is flagged, return flagged_lines as [].',
    '- Use the provided line numbers from the transcript lines.',
    '',
    'Video metadata:',
    `- title: ${title || ''}`,
    `- video_id: ${videoId || ''}`,
    `- youtube_url: ${youtubeUrl || ''}`,
    `- language: ${language || ''}`,
    `- duration_seconds: ${durationSeconds || ''}`,
    '',
    'Transcript lines:',
    numberedLines
  ].join('\n');

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  });

  const text = result?.response?.text?.() || '';
  const json = extractJson(text);
  if (!json) {
    const err = new Error('Gemini returned non-JSON response');
    err.raw = text;
    throw err;
  }

  const parsed = GeminiResultSchema.safeParse(json);
  if (!parsed.success) {
    const err = new Error('Gemini JSON did not match expected schema');
    err.raw = json;
    err.zodError = parsed.error;
    throw err;
  }

  // Ensure arrays/objects exist for UI stability.
  const normalized = {
    topic: parsed.data.topic || '',
    context: parsed.data.context || '',
    summary: parsed.data.summary || '',
    flags: parsed.data.flags || {
      hate: { present: false, severity: 'none', notes: '' },
      violence: { present: false, severity: 'none', notes: '' },
      sensitive: { present: false, severity: 'none', notes: '' }
    },
    flagged_lines: Array.isArray(parsed.data.flagged_lines) ? parsed.data.flagged_lines : [],
    raw_response: text
  };

  return { model: modelName, ...normalized, transcript_lines: lines };
}

module.exports = {
  analyzeTranscriptWithGemini,
  splitTranscriptIntoLines,
  categorizeText
};

const CategorizationResultSchema = z
  .object({
    category: z.string(),
    confidence: z.number().optional(),
    reasoning: z.string(),
    is_communal: z.boolean().optional(),
    is_political: z.boolean().optional()
  })
  .passthrough();

/**
 * Categorize text using Gemini LLM with dynamic categories and few-shot examples.
 * @param {string} text - The content to analyze
 * @param {string[]} categories - List of valid categories to choose from
 * @param {object[]} examples - Optional list of { text, category, reasoning } examples
 */
async function categorizeText(text, categories, examples = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY missing. Skipping LLM categorization.');
    return null;
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json' }
  });

  const categoriesList = categories.map(c => `- ${c}`).join('\n');

  let examplesText = '';
  if (examples && examples.length > 0) {
    examplesText = '\nReference Examples (Use these to understand the task):\n' +
      examples.map(ex => `Input: "${ex.text}"\nCategory: ${ex.category}\nReasoning: ${ex.reasoning || ''}\n---`).join('\n');
  }

  const prompt = `
    You are an expert content moderator for an Indian social media platforms context.
    
    Task: specificially categorize the following text into ONE of the provided categories.
    
    Valid Categories:
    ${categoriesList}
    
    ${examplesText}
    
    Input Text to Analyze:
    "${text}"
    
    Instructions:
    1. specificially distinguish between "Political Criticism" (disagreement with policy/party) and "Communal Hate" (attacking a religion/community).
    2. If the text attacks a religion (Hindu/Muslim/Christian etc.), tag as "Communal Hate/Violence".
    3. If the text criticizes a government, politician, or policy without religious attacks, tag as "Political Criticism" or "Political Statement".
    4. Return strict JSON.

    Output JSON Schema:
    {
      "category": "String (must be exactly one from the provided list)",
      "confidence": Number (0.0 to 1.0),
      "reasoning": "String (brief explanation of why this category fits)",
      "is_communal": Boolean,
      "is_political": Boolean
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const json = extractJson(responseText);

    if (!json) return null;

    const parsed = CategorizationResultSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    } else {
      console.warn('[Gemini] Schema validation failed:', parsed.error);
      return json; // Return raw JSON if schema fails but structure is usable
    }
  } catch (error) {
    console.error('[Gemini] Categorization failed:', error.message);
    return null;
  }
}
