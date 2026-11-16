'use strict';
const { HttpError, MODELS, handle, parseJsonLoose } = require('./_lib');

function buildPrompt(reference) {
  let p = `You are a speech-to-text and pronunciation analyst for an English learner whose native language is Korean.
Listen to the audio and return ONLY a JSON object with exactly this shape:
{
  "speech_detected": boolean,
  "transcript": string,
  "pronunciation_issues": [ { "word": string, "type": "sound" | "stress", "issue_ko": string } ],
  "delivery_ko": string,
  "reference_diff": [ string ]
}
Rules:
- transcript: the words actually spoken, verbatim. If the speaker says a Korean word or phrase (usually because they cannot recall the English), write that part in Hangul wrapped in double quotes, e.g. I went to "증평" last weekend. Never translate it and never turn it into English-looking letters. Do NOT fix grammar, do NOT complete unfinished sentences, keep fillers (um, uh) and repeated words. No timestamps or speaker labels.
- If there is no intelligible speech (silence, background noise only), set speech_detected to false and transcript to "". Never invent words.
- pronunciation_issues: ignore the Korean parts; up to 10 English words (each word at most once, spelled exactly as it is written in the text) that were clearly mispronounced or stressed wrongly, especially problems typical of Korean speakers (r/l, f/p, v/b, th, final consonants, vowel length, word stress). type is "sound" for a wrong or unclear sound, "stress" for wrong word stress. issue_ko is ONE short Korean line: what went wrong and the correct target. Show stress by spelling the syllables with the stressed one in capitals, e.g. an-ni-VER-sa-ry. NEVER use IPA or phonetic symbols (no [ ] or ˈ ɔː ə); explain with Hangul or plain letters only. Empty array if none.
- delivery_ko: 1-2 short Korean sentences about intonation, stress, pace, pauses and hesitation.`;
  if (reference) {
    p += `
- reference_diff: the learner was asked to read the REFERENCE TEXT below aloud. List the words that were omitted, added or replaced, e.g. "omitted: free", "said 'ship' instead of 'sheep'". Empty array if it matched.

REFERENCE TEXT:
"""
${reference.slice(0, 1500)}
"""`;
  } else {
    p += `
- reference_diff: always an empty array.`;
  }
  return p;
}

async function callGemini(prompt, audio, mime, useThinking, model, timeoutMs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, '서버에 GEMINI_API_KEY 환경변수가 설정되어 있지 않아요.');
  const generationConfig = { responseMimeType: 'application/json' };
  if (useThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: audio } }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { timeout: true };
  }
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

module.exports = handle(async (body) => {
  const { audio, reference = '' } = body;
  const mime = 'audio/wav';
  if (typeof audio !== 'string' || audio.length < 200) throw new HttpError(400, '오디오 데이터가 비어 있어요.');
  if (audio.length > 4_000_000) throw new HttpError(413, '녹음이 너무 길어요 (최대 약 2분).');

  const prompt = buildPrompt(String(reference || ''));
  const started = Date.now();
  const left = () => Math.max(5000, 54000 - (Date.now() - started));
  const main = MODELS.gemini();
  const backup = process.env.GEMINI_MODEL_BACKUP || 'gemini-3.5-flash-lite';
  // 1차: 기본 모델(22초 제한) → 멈추면 가벼운 모델로 자동 재시도
  let res = await callGemini(prompt, audio, mime, true, main, 22000);
  if (!res.timeout && res.r.status === 400) res = await callGemini(prompt, audio, mime, false, main, 22000);
  if (res.timeout || (res.r && (res.r.status === 429 || res.r.status >= 500))) {
    res = await callGemini(prompt, audio, mime, false, backup, left());
  }
  if (res.timeout) throw new HttpError(504, 'Gemini 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.');
  const { r, data } = res;
  if (!r.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'unknown';
    throw new HttpError(502, `Gemini API 오류 (${r.status}): ${msg}`);
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new HttpError(502, 'Gemini가 이 오디오를 처리하지 못했어요. 다시 녹음해 주세요.');
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || '').join('');
  const j = parseJsonLoose(text);
  if (!j) throw new HttpError(502, 'Gemini 응답을 해석하지 못했어요. 다시 시도해 주세요.');

  const transcript = typeof j.transcript === 'string' ? j.transcript.trim() : '';
  return {
    speech_detected: j.speech_detected !== false && transcript.length > 0,
    transcript,
    pronunciation_issues: Array.isArray(j.pronunciation_issues)
      ? j.pronunciation_issues.slice(0, 10).map((x) => ({ word: String((x && x.word) || '').trim(), type: x && x.type === 'stress' ? 'stress' : 'sound', issue_ko: String((x && x.issue_ko) || '') })).filter((x) => x.word)
      : [],
    delivery_ko: typeof j.delivery_ko === 'string' ? j.delivery_ko : '',
    reference_diff: Array.isArray(j.reference_diff) ? j.reference_diff.slice(0, 12).map(String) : [],
  };
});
