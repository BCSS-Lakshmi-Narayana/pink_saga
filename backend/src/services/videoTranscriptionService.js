/**
 * Video Transcription Service
 *
 * Downloads a video/audio URL → converts to 16kHz mono WAV via ffmpeg →
 * transcribes via Sarvam batch API (same logic as transcribeController.js).
 * Returns the transcript string or null on failure.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const axios = require('axios');

const SARVAM_BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';
const CHUNK_SECS = 25;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB safety cap

function getSarvamKey() {
  return (
    process.env.SARVAM_API_KEY ||
    process.env.SARVAM_API_SUBSCRIPTION_KEY ||
    process.env.SARVAM_SUBSCRIPTION_KEY ||
    ''
  ).trim();
}

function sarvamHeaders() {
  return { 'api-subscription-key': getSarvamKey(), 'Content-Type': 'application/json' };
}

// Pick headers that let us download from social CDNs
function downloadHeaders(url) {
  const h = { 'User-Agent': 'Mozilla/5.0 (compatible; SagaBot/1.0)' };
  if (url.includes('twimg.com')) {
    h['Referer'] = 'https://twitter.com/';
    h['Origin'] = 'https://twitter.com';
  } else if (url.includes('fbcdn.net') || url.includes('facebook.com')) {
    h['Referer'] = 'https://www.facebook.com/';
  } else if (url.includes('cdninstagram.com') || url.includes('instagram.com')) {
    h['Referer'] = 'https://www.instagram.com/';
  }
  return h;
}

async function downloadToFile(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    headers: downloadHeaders(url),
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
  });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    response.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    response.data.on('error', reject);
  });
}

function convertToWav(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -f wav "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function getDurationSecs(wavPath) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${wavPath}"`,
    { stdio: 'pipe' }
  ).toString().trim();
  return parseFloat(out) || 0;
}

function splitWav(wavPath, maxSecs) {
  const total = getDurationSecs(wavPath);
  if (total <= maxSecs) return [wavPath];
  const n = Math.ceil(total / maxSecs);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const cp = wavPath.replace('.wav', `_c${i}.wav`);
    execSync(
      `ffmpeg -y -i "${wavPath}" -ss ${i * maxSecs} -t ${maxSecs} -c copy "${cp}"`,
      { stdio: 'pipe' }
    );
    chunks.push(cp);
  }
  return chunks;
}

async function batchTranscribeChunk(wavPath, language = 'unknown') {
  const filename = path.basename(wavPath);
  const h = sarvamHeaders();

  // 1. Create job
  const { data: jobData } = await axios.post(
    SARVAM_BASE,
    { job_parameters: { language_code: language, model: 'saarika:v2.5', with_timestamps: false } },
    { headers: h, timeout: 30000 }
  );
  const jobId = jobData.job_id;

  // 2. Get presigned upload URL
  const { data: upData } = await axios.post(
    `${SARVAM_BASE}/upload-files`,
    { job_id: jobId, files: [filename] },
    { headers: h, timeout: 30000 }
  );
  const presignedUrl = upData.upload_urls[filename].file_url;

  // 3. Upload WAV
  const buf = fs.readFileSync(wavPath);
  await axios.put(presignedUrl, buf, {
    headers: { 'Content-Type': 'audio/wav' },
    maxBodyLength: Infinity,
    timeout: 120000,
  });

  // 4. Start job
  await axios.post(`${SARVAM_BASE}/start`, { job_id: jobId }, { headers: h, timeout: 30000 });

  // 5. Poll (max 8 min)
  const deadline = Date.now() + 480_000;
  let state = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const { data: st } = await axios.get(`${SARVAM_BASE}/${jobId}`, { headers: h, timeout: 30000 });
    state = st.job_state;
    if (state === 'Completed') break;
    if (state === 'Failed') throw new Error(`Sarvam job failed: ${st.error_message || 'unknown'}`);
  }
  if (state !== 'Completed') throw new Error('Sarvam transcription timed out');

  // 6. Download result
  const { data: dlData } = await axios.get(`${SARVAM_BASE}/${jobId}/download`, { headers: h, timeout: 30000 });
  const dlUrl = dlData.download_urls[filename].file_url;
  const { data: result } = await axios.get(dlUrl, { timeout: 60000 });
  return result.transcript || '';
}

function cleanup(...paths) {
  for (const p of paths) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

/**
 * Main entry point. Returns transcript string or null.
 * @param {string} videoUrl - Direct MP4/video URL
 * @param {string} [language] - ISO language hint (default: 'unknown' = auto)
 */
async function transcribeVideoUrl(videoUrl, language = 'unknown') {
  const log = (msg) => console.log(`[VideoTranscribe] ${msg}`);

  if (!getSarvamKey()) {
    log('SARVAM_API_KEY not set — skipping video transcription');
    return null;
  }

  // Skip URLs we can't directly download (YouTube, HLS streams)
  if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') || videoUrl.includes('.m3u8')) {
    log(`Skipping unsupported URL type: ${videoUrl.substring(0, 60)}`);
    return null;
  }

  const ts = Date.now();
  const tmpDir = os.tmpdir();
  const ext = videoUrl.match(/\.(mp4|webm|mov|mkv)(\?|$)/i)?.[1] || 'mp4';
  const rawPath = path.join(tmpDir, `saga_vt_${ts}.${ext}`);
  const wavPath = path.join(tmpDir, `saga_vt_${ts}.wav`);
  let chunkPaths = [];

  try {
    log(`Downloading: ${videoUrl.substring(0, 80)}`);
    await downloadToFile(videoUrl, rawPath);
    log('Converting to WAV...');
    convertToWav(rawPath, wavPath);

    const chunks = splitWav(wavPath, CHUNK_SECS);
    chunkPaths = chunks.filter(c => c !== wavPath);

    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      log(`Transcribing chunk ${i + 1}/${chunks.length}...`);
      const text = await batchTranscribeChunk(chunks[i], language);
      if (text) parts.push(text.trim());
    }

    const transcript = parts.join(' ').trim();
    log(`Transcript (${transcript.length} chars): "${transcript.substring(0, 80)}..."`);
    return transcript || null;
  } catch (err) {
    log(`Failed: ${err.message}`);
    return null;
  } finally {
    cleanup(rawPath, wavPath, ...chunkPaths);
  }
}

module.exports = { transcribeVideoUrl };
