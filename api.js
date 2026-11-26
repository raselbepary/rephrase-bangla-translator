// Shared translation/AI backends used by the popup, the options page and the
// service worker.
// - Translation always uses Google Translate's free endpoint (no key needed).
// - AI tasks (rephrasing, reply drafting) go to whichever provider is
//   configured in Settings: Gemini (native API) or any OpenAI-compatible
//   server (OpenAI, DeepSeek, Grok, Ollama, LM Studio, llama.cpp, vLLM, ...).

const MAX_CHARS = 5000;

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

// Google retires model names over time. Try the current name first; when a
// model 404s, the API's error message names its replacement, which the code
// below picks up automatically.
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

// Remembers the last Gemini model that worked so later calls skip the chain.
let lastGoodModel = '';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    kind: 'gemini',
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.6-flash',
    needsKey: true,
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5-mini',
    needsKey: true,
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-…',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    needsKey: true,
  },
  grok: {
    label: 'Grok (xAI)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyHint: 'xai-…',
    keyUrl: 'https://console.x.ai',
    defaultModel: 'grok-4.1-fast',
    needsKey: true,
  },
  custom: {
    label: 'Custom / Local LLM',
    kind: 'openai',
    baseUrl: '',
    keyHint: 'optional — most local servers need no key',
    defaultModel: '',
    needsKey: false,
  },
};

// Resolves the effective AI config. `keys` and `models` are keyed by provider
// id so each provider remembers its own key and model choice.
export function resolveAi({ provider = 'gemini', keys = {}, models = {}, baseUrl = '' } = {}) {
  const id = PROVIDERS[provider] ? provider : 'gemini';
  const conf = PROVIDERS[id];
  const url = (id === 'custom' ? baseUrl : conf.baseUrl || '').trim().replace(/\/+$/, '');
  const key = (keys[id] || '').trim();
  const model = (models[id] || '').trim() || conf.defaultModel;

  let ready = false;
  let reason = '';
  if (id === 'custom' && !url) reason = 'set the server URL';
  else if (conf.needsKey && !key) reason = `add a ${conf.label} API key`;
  else if (!model) reason = 'choose a model';
  else ready = true;

  return {
    provider: id,
    label: conf.label,
    baseUrl: url,
    key,
    model,
    ready,
    reason,
    engine: `${conf.label} · ${model}`,
  };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get({
    provider: 'gemini',
    tone: 'standard',
    targetLang: 'bn',
    baseUrl: '',
    keys: {},
    models: {},
    customTones: [],
    model: '', // legacy: Gemini-only era model override
    apiKey: '', // legacy: Gemini-only era key
  });
  const keys = { ...stored.keys };
  const models = { ...stored.models };
  if (!keys.gemini && stored.apiKey) keys.gemini = stored.apiKey;
  if (!models.gemini && stored.model) models.gemini = stored.model;

  return {
    provider: stored.provider,
    tone: stored.tone,
    targetLang: stored.targetLang,
    baseUrl: stored.baseUrl,
    keys,
    models,
    customTones: Array.isArray(stored.customTones) ? stored.customTones : [],
    ai: resolveAi({ provider: stored.provider, keys, models, baseUrl: stored.baseUrl }),
  };
}

// ---------------------------------------------------------------------------
// Gemini (native API)
// ---------------------------------------------------------------------------

function extractSuggestedModel(hint) {
  const match = hint && hint.match(/models\/([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

export async function geminiGenerate(apiKey, prompt, preferredModel = '') {
  const candidates = [preferredModel || lastGoodModel, ...GEMINI_MODELS].filter(Boolean);
  const tried = new Set();
  let lastError = new Error('Gemini request failed');

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        let hint = '';
        try {
          hint = JSON.parse(detail)?.error?.message || '';
        } catch {
          /* non-JSON error body */
        }
        lastError = new Error(`Gemini (${model}) error (HTTP ${res.status})${hint ? `: ${hint}` : ''}`);
        if (res.status === 404) {
          // The 404 message usually names the replacement model (e.g.
          // "...use models/gemini-3.6-flash...") — queue it as the next try.
          const suggested = extractSuggestedModel(hint);
          if (suggested && !tried.has(suggested)) candidates.splice(i + 1, 0, suggested);
          continue;
        }
        // 400/403 usually means this model name isn't available for the
        // key — try the next one.
        if (res.status === 400 || res.status === 403) continue;
        throw lastError;
      }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim()
        // The model sometimes wraps the answer in quotes despite instructions.
        .replace(/^["“”']+|["“”']+$/g, '');
      if (text) {
        lastGoodModel = model;
        return text;
      }
      lastError = new Error(`Gemini (${model}) returned an empty response`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat completions (OpenAI, DeepSeek, Grok, local servers)
// ---------------------------------------------------------------------------

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function readErrorHint(detail) {
  try {
    const parsed = JSON.parse(detail);
    const error = parsed?.error;
    if (typeof error === 'string') return error;
    if (error?.message) return String(error.message);
  } catch {
    /* not JSON */
  }
  return '';
}

export async function openaiComplete(baseUrl, key, model, prompt) {
  if (!baseUrl) throw new Error('No server URL configured');
  if (!model) throw new Error('No model configured');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(key) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = readErrorHint(detail);
    let host = baseUrl;
    try {
      host = new URL(baseUrl).host;
    } catch {
      /* keep the raw URL */
    }
    throw new Error(`${host} error (HTTP ${res.status})${hint ? `: ${hint}` : ''}`);
  }
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '')
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '');
  if (!text) throw new Error(`${model} returned an empty response`);
  return text;
}

// Fills the model list in Settings. GET {baseUrl}/models works on all the
// OpenAI-compatible providers, including Ollama and LM Studio.
export async function listModels(baseUrl, key) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: authHeaders(key) });
  if (!res.ok) {
    const hint = readErrorHint(await res.text().catch(() => ''));
    throw new Error(`could not load models (HTTP ${res.status})${hint ? `: ${hint}` : ''}`);
  }
  const data = await res.json();
  return (Array.isArray(data?.data) ? data.data : [])
    .map((m) => m?.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// Unified entry point: `ai` is the object returned by resolveAi()/getSettings().
export async function llmComplete(prompt, ai) {
  if (!ai?.ready) throw new Error(`No AI provider configured — ${ai?.reason || 'set one up in Settings (⚙)'}.`);
  if (ai.provider === 'gemini') return geminiGenerate(ai.key, prompt, ai.model);
  return openaiComplete(ai.baseUrl, ai.key, ai.model, prompt);
}

// ---------------------------------------------------------------------------
// Google Translate (free endpoint)
// ---------------------------------------------------------------------------

export function isBangla(text) {
  const letters = text.replace(/\s/g, '');
  if (!letters) return false;
  const bangla = (text.match(/[\u0980-\u09FF]/g) || []).length;
  return bangla / letters.length >= 0.3;
}

export async function googleTranslate(text, { from = 'auto', to = 'bn' } = {}) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from,
    tl: to,
    dt: 't',
    q: text.slice(0, MAX_CHARS),
  });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
  if (!res.ok) throw new Error(`Translation service error (HTTP ${res.status})`);
  const data = await res.json();
  const translated = Array.isArray(data?.[0])
    ? data[0].map((segment) => (Array.isArray(segment) ? segment[0] || '' : '')).join('')
    : '';
  if (!translated.trim()) throw new Error('Translation service returned no text');
  return translated;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TONE_PROMPTS = {
  standard: 'Rephrase the text with clearer, more natural wording while keeping the same meaning, language and approximate length.',
  formal: 'Rephrase the text in a formal, professional tone while keeping the same meaning and language.',
  casual: 'Rephrase the text in a casual, friendly, conversational tone while keeping the same meaning and language.',
  simple: 'Rephrase the text using simple words and short sentences that are easy to understand, while keeping the same meaning and language.',
  concise: 'Rephrase the text more concisely and remove redundancy, while keeping the same meaning and language.',
};

const REPLY_TONES = {
  standard: 'friendly and natural',
  formal: 'polite and professional',
  casual: 'casual and playful',
  simple: 'simple and clear',
  concise: 'short and to the point',
};

// ---------------------------------------------------------------------------
// Custom tones (user-defined presets, managed in Settings)
// ---------------------------------------------------------------------------

// Stored tone values for presets are "preset:<id>" so the built-in tone names
// keep working and a deleted preset can fall back to Standard without errors.
const PRESET_PREFIX = 'preset:';

export function presetValue(id) {
  return `${PRESET_PREFIX}${id}`;
}

// Returns the matching preset when `tone` refers to a saved preset with a
// non-empty prompt, otherwise null.
export function findCustomTone(tone, customTones = []) {
  if (typeof tone !== 'string' || !tone.startsWith(PRESET_PREFIX)) return null;
  const id = tone.slice(PRESET_PREFIX.length);
  const preset = (Array.isArray(customTones) ? customTones : []).find((entry) => entry && entry.id === id);
  if (!preset) return null;
  const prompt = String(preset.prompt || '').trim();
  if (!prompt) return null;
  return {
    id,
    name: String(preset.name || '').trim() || 'Custom tone',
    prompt,
  };
}

// Human-readable tone name for the "engine" label in the popup and cards.
export function toneLabel(tone = 'standard', customTones = []) {
  return findCustomTone(tone, customTones)?.name || (TONE_PROMPTS[tone] ? tone : 'standard');
}

export async function rephrase(text, { tone = 'standard', customTones = [], ai = null } = {}) {
  const input = text.slice(0, MAX_CHARS).trim();
  if (!input) throw new Error('Nothing to rephrase');

  const preset = findCustomTone(tone, customTones);
  if (!ai?.ready && preset) {
    throw new Error('Custom tones need an AI provider — add one in Settings (⚙).');
  }

  if (ai?.ready) {
    const instruction = preset?.prompt || TONE_PROMPTS[tone] || TONE_PROMPTS.standard;
    const prompt = `${instruction}\n\nText:\n"""\n${input}\n"""\n\nReturn only the rephrased text — no quotes, no commentary.`;
    return llmComplete(prompt, ai);
  }

  // No AI provider configured: paraphrase by round-tripping through the other
  // language. Crude, but free and keyless.
  const bridgeFrom = isBangla(input) ? 'bn' : 'en';
  const bridgeTo = bridgeFrom === 'bn' ? 'en' : 'bn';
  const bridged = await googleTranslate(input, { from: bridgeFrom, to: bridgeTo });
  return googleTranslate(bridged, { from: bridgeTo, to: bridgeFrom });
}

// Drafts a short chat reply to the given message. Needs an AI provider — a
// translate round-trip cannot compose new sentences.
export async function draftReply(text, { tone = 'standard', customTones = [], ai = null } = {}) {
  const input = text.slice(0, MAX_CHARS).trim();
  if (!input) throw new Error('Nothing to draft a reply to');
  if (!ai?.ready) {
    throw new Error(`Reply drafting needs an AI provider — ${ai?.reason || 'configure one in Settings (⚙)'}.`);
  }
  const preset = findCustomTone(tone, customTones);
  const styleRule = preset
    ? `- Match this style: ${preset.prompt}\n- Keep it brief (1-3 sentences).`
    : `- Keep it ${REPLY_TONES[tone] || REPLY_TONES.standard} and brief (1-3 sentences).`;
  const prompt = `You are drafting a reply for a chat app (e.g. Discord).

Message to reply to:
"""
${input}
"""

Rules:
- Reply in the SAME language as the message (Bangla message → Bangla reply, English → English).
${styleRule}
- If the selection contains usernames, timestamps or channel names, treat them as metadata and reply to the actual message.
- Return only the reply text — no quotes, no commentary.`;
  return llmComplete(prompt, ai);
}

const LANG_NAMES = { bn: 'Bangla (বাংলা)', en: 'English' };

// Translation uses the free Google Translate endpoint first; if that fails
// (most commonly HTTP 429 rate limiting) and an AI provider is configured,
// the text is translated with the AI model instead.
export async function translate(text, { to = 'bn', ai = null } = {}) {
  const input = text.slice(0, MAX_CHARS).trim();
  if (!input) throw new Error('Nothing to translate');

  try {
    const result = await googleTranslate(input, { to });
    return { text: result, engine: 'Google Translate' };
  } catch (error) {
    if (!ai?.ready) throw error;
    const language = LANG_NAMES[to] || to;
    const prompt = `Translate the following text to ${language}.
If the text is already in ${language}, return it unchanged.
Preserve the tone, formatting and line breaks.

Text:
"""
${input}
"""

Return only the translation — no quotes, no commentary.`;
    const result = await llmComplete(prompt, ai);
    return { text: result, engine: `${ai.model} · AI fallback` };
  }
}
