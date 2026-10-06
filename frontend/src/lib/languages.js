/**
 * Content languages tracked for Telangana. Mirrors the backend enums
 * (Keyword/Event: en, te, ur, hi, all; NewsArticle: en, te, ur, hi, unknown).
 *
 * Telugu is the state's official language and the language of most political
 * discourse, press and regional television. Urdu is Telangana's SECOND
 * official language and is genuinely load-bearing in Hyderabad — it is the
 * working language of AIMIM's Old City base and of the city's Urdu press, so
 * it is tracked as a first-class language rather than lumped into "other".
 *
 * English is over-represented on X relative to its share of offline
 * discourse, because leaders post bilingually for national media. Hindi
 * appears mainly through BJP national messaging.
 *
 * Note a large share of Telugu social media is written in LATIN script
 * (romanised Telugu / "Telgish"). It is tagged 'te' — the language is Telugu
 * whatever script it is typed in.
 */
export const LANGUAGE_LABELS = {
  en: 'English',
  te: 'Telugu',
  ur: 'Urdu',
  hi: 'Hindi',
  all: 'All',
  unknown: 'Unknown',
};

/* Options for keyword / event language pickers, in display order. */
export const KEYWORD_LANGUAGE_OPTIONS = ['en', 'te', 'ur', 'hi', 'all'].map((value) => ({
  value,
  label: LANGUAGE_LABELS[value],
}));

export const languageLabel = (code) => LANGUAGE_LABELS[code] || LANGUAGE_LABELS.en;

/**
 * Google Input Tools code for phonetic typing — types Telugu script from a
 * romanised spelling, which is how most people enter Telugu on a QWERTY
 * keyboard. Urdu and Hindi have their own tools; anything unrecognised
 * defaults to Telugu, this deployment's primary language.
 */
export const transliterationCode = (lang) =>
  ({ te: 'te-t-i0-und', ur: 'ur-t-i0-und', hi: 'hi-t-i0-und' }[lang] || 'te-t-i0-und');
