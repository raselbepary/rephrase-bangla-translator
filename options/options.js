import { PROVIDERS, getSettings, resolveAi, listModels, llmComplete } from '../api.js';

const providerSel = document.getElementById('provider');
const keyInput = document.getElementById('apiKey');
const keyLink = document.getElementById('keyLink');
const urlRow = document.getElementById('urlRow');
const urlInput = document.getElementById('baseUrl');
const urlHint = document.getElementById('urlHint');
const modelInput = document.getElementById('model');
const modelList = document.getElementById('modelList');
const loadModelsBtn = document.getElementById('loadModels');
const testBtn = document.getElementById('test');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const toneList = document.getElementById('toneList');
const addToneBtn = document.getElementById('addTone');
const saveTonesBtn = document.getElementById('saveTones');
const tonesStatusEl = document.getElementById('tonesStatus');

// Per-provider keys/models, loaded from storage; the provider being edited
// right now. Switching providers swaps the key/model fields while keeping
// each provider's own values.
let stored = { keys: {}, models: {}, baseUrl: '' };
let activeId = 'gemini';
let customTones = [];

init();

async function init() {
  const settings = await getSettings();
  stored = { keys: settings.keys, models: settings.models, baseUrl: settings.baseUrl };
  activeId = settings.provider;
  providerSel.value = activeId;
  applyProviderUi();
  keyInput.value = settings.keys[activeId] || '';
  urlInput.value = settings.baseUrl || '';
  modelInput.value = settings.models[activeId] || '';
  customTones = Array.isArray(settings.customTones) ? settings.customTones : [];
  renderTones();

  providerSel.addEventListener('change', onProviderChange);
  loadModelsBtn.addEventListener('click', loadModels);
  testBtn.addEventListener('click', testProvider);
  saveBtn.addEventListener('click', save);
  addToneBtn.addEventListener('click', addTone);
  saveTonesBtn.addEventListener('click', saveTones);
  for (const input of [keyInput, urlInput, modelInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveBtn.click();
    });
  }
}

function applyProviderUi() {
  const conf = PROVIDERS[activeId];
  const isCustom = activeId === 'custom';
  urlRow.classList.toggle('hidden', !isCustom);
  urlHint.classList.toggle('hidden', !isCustom);
  keyInput.placeholder = conf.keyHint;
  keyLink.classList.toggle('hidden', !conf.keyUrl);
  if (conf.keyUrl) keyLink.href = conf.keyUrl;
  modelInput.placeholder = conf.defaultModel ? `default: ${conf.defaultModel}` : 'e.g. llama3.1, qwen2.5…';
  // Gemini picks its model automatically (with 404 self-healing), and its
  // /models endpoint is not OpenAI-shaped — hide the loader there.
  loadModelsBtn.classList.toggle('hidden', activeId === 'gemini');
}

function onProviderChange() {
  // Keep what was typed for the provider we are leaving.
  stored.keys[activeId] = keyInput.value.trim();
  stored.models[activeId] = modelInput.value.trim();
  stored.baseUrl = urlInput.value.trim();

  activeId = providerSel.value;
  applyProviderUi();
  keyInput.value = stored.keys[activeId] || '';
  modelInput.value = stored.models[activeId] || '';
  setStatus('');
}

// The AI config as currently typed (before saving) — used by Test and by the
// model loader so they reflect what the user sees.
function liveAi() {
  return resolveAi({
    provider: activeId,
    keys: { ...stored.keys, [activeId]: keyInput.value.trim() },
    models: { ...stored.models, [activeId]: modelInput.value.trim() },
    baseUrl: urlInput.value.trim(),
  });
}

// Custom/local servers live on arbitrary origins — Chrome only lets the
// extension fetch there if the user grants a host permission.
async function ensureOriginPermission(url) {
  try {
    const origin = `${new URL(url).origin}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function save() {
  const ai = liveAi();
  stored.keys[activeId] = keyInput.value.trim();
  stored.models[activeId] = modelInput.value.trim();
  stored.baseUrl = urlInput.value.trim();
  await chrome.storage.local.set({
    provider: activeId,
    keys: stored.keys,
    models: stored.models,
    baseUrl: stored.baseUrl,
  });

  let message = 'Saved ✓';
  let className = 'ok';
  if (activeId === 'custom' && ai.baseUrl && !(await ensureOriginPermission(ai.baseUrl))) {
    message = 'Saved, but Chrome may block requests to this server — click Save again and allow the permission when prompted.';
    className = 'error';
  }
  setStatus(message, className);
}

async function loadModels() {
  const ai = liveAi();
  if (!ai.baseUrl) {
    setStatus('Set the server URL first.', 'error');
    return;
  }
  setStatus('Loading models…');
  try {
    const ids = await listModels(ai.baseUrl, ai.key);
    modelList.innerHTML = '';
    for (const id of ids) {
      const option = document.createElement('option');
      option.value = id;
      modelList.append(option);
    }
    if (ids.length) {
      setStatus(`${ids.length} models loaded — click the Model field to pick one.`, 'ok');
      modelInput.focus();
    } else {
      setStatus('The server returned an empty model list.', 'error');
    }
  } catch (error) {
    setStatus(`Could not load models — ${error.message}`, 'error');
  }
}

async function testProvider() {
  const ai = liveAi();
  if (!ai.ready) {
    setStatus(`Not configured — ${ai.reason}.`, 'error');
    return;
  }
  if (activeId === 'custom' && !(await ensureOriginPermission(ai.baseUrl))) {
    setStatus('Chrome permission for this server was not granted — the request may be blocked.', 'error');
    return;
  }
  setStatus('Testing…');
  try {
    const reply = await llmComplete('Reply with the single word: OK', ai);
    setStatus(`Works ✓ (${ai.model}) replied: ${reply.slice(0, 40)}`, 'ok');
  } catch (error) {
    setStatus(`Failed — ${error.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Custom tones
// ---------------------------------------------------------------------------

function newToneId() {
  return `preset_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function renderTones() {
  toneList.innerHTML = '';
  if (!customTones.length) {
    const empty = document.createElement('p');
    empty.className = 'hint tone-empty';
    empty.textContent = 'No custom tones yet — click “Add tone” to create one.';
    toneList.append(empty);
    return;
  }
  for (const preset of customTones) toneList.append(toneRow(preset));
}

function toneRow(preset = {}) {
  const card = document.createElement('div');
  card.className = 'tone-card';
  card.dataset.id = preset.id || newToneId();

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'tone-name';
  name.placeholder = 'Tone name, e.g. Jermaine Griggs';
  name.value = preset.name || '';
  name.autocomplete = 'off';
  name.spellcheck = false;

  const prompt = document.createElement('textarea');
  prompt.className = 'tone-prompt';
  prompt.rows = 3;
  prompt.placeholder = "e.g. Rephrase in Jermaine Griggs' voice, in a helpful and polite way.";
  prompt.value = preset.prompt || '';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'tone-delete';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    card.remove();
    if (!toneList.querySelector('.tone-card')) {
      customTones = [];
      renderTones();
    }
    setTonesStatus('');
  });

  const foot = document.createElement('div');
  foot.className = 'tone-card-foot';
  foot.append(deleteBtn);

  card.append(name, prompt, foot);
  return card;
}

function addTone() {
  toneList.querySelector('.tone-empty')?.remove();
  const card = toneRow({ id: newToneId() });
  toneList.append(card);
  card.querySelector('.tone-name').focus();
  setTonesStatus('');
}

async function saveTones() {
  const tones = [];
  for (const card of toneList.querySelectorAll('.tone-card')) {
    const name = card.querySelector('.tone-name').value.trim();
    const prompt = card.querySelector('.tone-prompt').value.trim();
    if (!name && !prompt) continue; // skip blank rows
    tones.push({ id: card.dataset.id || newToneId(), name: name || 'Custom tone', prompt });
  }

  customTones = tones;
  await chrome.storage.local.set({ customTones: tones });

  // If the selected tone was a preset that just disappeared, reset it so the
  // popup and shortcuts fall back cleanly to Standard.
  const { tone = 'standard' } = await chrome.storage.local.get('tone');
  if (typeof tone === 'string' && tone.startsWith('preset:')) {
    const id = tone.slice('preset:'.length);
    if (!tones.some((entry) => entry.id === id && entry.prompt)) {
      await chrome.storage.local.set({ tone: 'standard' });
    }
  }

  renderTones();
  setTonesStatus(tones.length === 1 ? '1 tone saved ✓' : `${tones.length} tones saved ✓`, 'ok');
}

function setTonesStatus(message, className = '') {
  tonesStatusEl.textContent = message;
  tonesStatusEl.className = className;
}

function setStatus(message, className = '') {
  statusEl.textContent = message;
  statusEl.className = className;
}
