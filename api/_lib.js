'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 모델은 환경변수로 바꿀 수 있어요 (모델명이 바뀌어도 코드 수정 없이 대응)
const MODELS = {
  fast: () => process.env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5', // 대화(빠르고 저렴)
  smart: () => process.env.CLAUDE_MODEL_SMART || 'claude-sonnet-5-5', // 출제·채점·리뷰
  gemini: () => process.env.GEMINI_MODEL || 'gemini-3.8-flash', // 받아쓰기+발음 메모
};

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// 내 API 크레딧을 아무나 못 쓰게 하는 간단한 비밀번호 보호
function guard(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST만 가능해요.' });
    return false;
  }
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: '서버에 APP_PASSWORD 환경변수가 설정되어 있지 않아요.' });
    return false;
  }
  const given = req.headers['x-app-password'] || '';
  if (!crypto.timingSafeEqual(sha(given), sha(expected))) {
    res.status(401).json({ error: '비밀번호가 올바르지 않아요.' });
    return false;
  }
  return true;
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

function handle(fn) {
  return async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const out = await fn(readBody(req));
      res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(e);
      res.status(status).json({ error: e.message || '서버 오류' });
    }
  };
}

// Claude를 "tool 호출 강제" 방식으로 불러서 항상 유효한 JSON을 받아요
async function callClaude({ model, system, messages, tool, maxTokens = 1500 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(500, '서버에 ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않아요.');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    throw new HttpError(504, 'Claude 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'unknown';
    throw new HttpError(502, `Claude API 오류 (${r.status}): ${msg}`);
  }
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block || !block.input) throw new HttpError(502, 'Claude 응답 형식이 올바르지 않아요.');
  return block.input;
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

module.exports = { HttpError, MODELS, guard, handle, callClaude, parseJsonLoose, pick };
