import { draftReply, getSettings, isBangla, presetValue, rephrase, toneLabel, translate } from '../api.js';

const $ = (id) => document.getElementById(id);

const els = {
  tabs: $('tabs'),
  tone: $('tone'),
  rephraseInput: $('rephraseInput'),
  rephraseBtn: $('rephraseBtn'),
  rephraseOut: $('rephraseOut'),
  rephraseText: $('rephraseText'),
  rephraseEngine: $('rephraseEngine'),
  rephraseCopy: $('rephraseCopy'),
  replyTone: $('replyTone'),
  replyInput: $('replyInput'),
  replyBtn: $('replyBtn'),
  replyOut: $('replyOut'),
  replyText: $('replyText'),
  replyEngine: $('replyEngine'),
  replyCopy: $('replyCopy'),
  translateInput: $('translateInput'),
  translateBtn: $('translateBtn'),
  translateOut: $('translateOut'),
  translateText: $('translateText'),
  translateEngine: $('translateEngine'),
  translateCopy: $('translateCopy'),
  swapLang: $('swapLang'),
  fromLabel: $('fromLabel'),
  toLabel: $('toLabel'),
  status: $('status'),
  openOptions: $('openOptions'),
};

let targetLang = 'bn';
let settings = { apiKey: '', tone: 'standard', customTones: [] };
let customTones = [];
let activeTone = 'standard';

const MANAGE_TONES_VALUE = '__manage';
const BUILTIN_TONES = ['standard', 'formal', 'casual', 'simple', 'concise'];

init();

async function init() {
  settings = await getSettings();
  customTones = Array.isArray(settings.customTones) ? settings.customTones : [];
  activeTone = ensureTone(settings.tone);
  if (settings.tone !== activeTone) chrome.storage.local.set({ tone: activeTone });
  settings.tone = activeTone;
  targetLang = settings.targetLang === 'en' ? 'en' : 'bn';
  populateToneSelects();
  selectTone(activeTone);
  updateDirection();
  setStatus(
    settings.ai.ready
      ? `AI mode — ${settings.ai.engine}.`
      : 'No AI provider set — rephrasing uses a translate round-trip and reply drafting is off. Add a provider in Settings (⚙).'
  );
  bind();
  await fillFromPageSelection();
  els.rephraseInput.focus();
}

function bind() {
  els.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  els.tone.addEventListener('change', onToneChange);
  els.replyTone.addEventListener('change', onToneChange);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.customTones) {
      customTones = Array.isArray(changes.customTones.newValue) ? changes.customTones.newValue : [];
      populateToneSelects();
      activeTone = ensureTone(activeTone);
      settings.tone = activeTone;
      selectTone(activeTone);
    }
    if (changes.tone) {
      activeTone = ensureTone(changes.tone.newValue);
      settings.tone = activeTone;
      selectTone(activeTone);
    }
  });

  els.rephraseBtn.addEventListener('click', () => run(rephraseTask()));
  els.replyBtn.addEventListener('click', () => run(replyTask()));
  els.translateBtn.addEventListener('click', () => run(translateTask()));
  els.rephraseInput.addEventListener('keydown', ctrlEnter(() => run(rephraseTask())));
  els.replyInput.addEventListener('keydown', ctrlEnter(() => run(replyTask())));
  els.translateInput.addEventListener('keydown', ctrlEnter(() => run(translateTask())));

  els.rephraseCopy.addEventListener('click', (event) => copyText(els.rephraseText.textContent, event.target));
  els.replyCopy.addEventListener('click', (event) => copyText(els.replyText.textContent, event.target));
  els.translateCopy.addEventListener('click', (event) => copyText(els.translateText.textContent, event.target));

  els.swapLang.addEventListener('click', () => {
    targetLang = targetLang === 'bn' ? 'en' : 'bn';
    updateDirection();
    chrome.storage.local.set({ targetLang });
  });

  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function ctrlEnter(handler) {
  return (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handler();
  };
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
}

// The tone setting is shared by the Rephrase and Reply tabs — keep both
// selects in sync. Saved custom tones are appended to both lists.
function onToneChange(event) {
  const value = event.target.value;
  if (value === MANAGE_TONES_VALUE) {
    selectTone(activeTone);
    chrome.runtime.openOptionsPage();
    return;
  }
  setTone(value);
}

function populateToneSelects() {
  for (const select of [els.tone, els.replyTone]) {
    select.querySelectorAll('option[data-preset], option[data-manage]').forEach((option) => option.remove());
    for (const preset of customTones) {
      if (!preset?.id) continue;
      const option = document.createElement('option');
      option.value = presetValue(preset.id);
      option.dataset.preset = preset.id;
      option.textContent = String(preset.name || '').trim() || 'Custom tone';
      select.append(option);
    }
    const manage = document.createElement('option');
    manage.value = MANAGE_TONES_VALUE;
    manage.dataset.manage = '1';
    manage.textContent = '＋ Manage custom tones…';
    select.append(manage);
  }
}

// Falls back to Standard when the stored preset was renamed/deleted.
function ensureTone(tone) {
  if (BUILTIN_TONES.includes(tone)) return tone;
  if (typeof tone === 'string' && tone.startsWith('preset:')) {
    const id = tone.slice('preset:'.length);
    if (customTones.some((preset) => preset?.id === id && String(preset.prompt || '').trim())) return tone;
  }
  return 'standard';
}

function selectTone(tone) {
  for (const select of [els.tone, els.replyTone]) {
    select.value = tone;
    if (select.value !== tone) select.value = 'standard';
  }
}

function setTone(value) {
  activeTone = ensureTone(value);
  settings.tone = activeTone;
  selectTone(activeTone);
  chrome.storage.local.set({ tone: activeTone });
}

// If the user opened the popup with text selected on the page, drop it into
// the Rephrase tab (the default). The Translate tab gets the same text so it
// is ready if the user switches over.
async function fillFromPageSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.activeElement;
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          const start = el.selectionStart;
          const end = el.selectionEnd;
          if (start != null && end != null && start !== end) return el.value.slice(start, end);
        }
        return window.getSelection ? window.getSelection().toString() : '';
      },
    });
    const text = (result?.result || '').trim();
    if (!text) return;
    els.rephraseInput.value = text;
    els.replyInput.value = text;
    els.translateInput.value = text;
    if (isBangla(text) && targetLang === 'bn') {
      targetLang = 'en';
      updateDirection();
      chrome.storage.local.set({ targetLang });
    }
  } catch {
    // Pages we cannot script (chrome://, Web Store, PDF viewer) — ignore.
  }
}

async function run(task) {
  const { button, busyLabel, work } = task;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = busyLabel;
  setStatus('');
  try {
    await work();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function rephraseTask() {
  return {
    button: els.rephraseBtn,
    busyLabel: 'Rephrasing…',
    work: async () => {
      const text = els.rephraseInput.value.trim();
      if (!text) {
        els.rephraseOut.classList.add('hidden');
        return;
      }
      const result = await rephrase(text, { tone: settings.tone, customTones, ai: settings.ai });
      els.rephraseText.textContent = result;
      els.rephraseText.classList.toggle('bangla', isBangla(result));
      els.rephraseEngine.textContent = settings.ai.ready
        ? `${settings.ai.engine} · ${toneLabel(settings.tone, customTones)}`
        : 'Basic (translate round-trip)';
      els.rephraseOut.classList.remove('hidden');
    },
  };
}

function replyTask() {
  return {
    button: els.replyBtn,
    busyLabel: 'Drafting…',
    work: async () => {
      const text = els.replyInput.value.trim();
      if (!text) {
        els.replyOut.classList.add('hidden');
        return;
      }
      const result = await draftReply(text, { tone: settings.tone, customTones, ai: settings.ai });
      els.replyText.textContent = result;
      els.replyText.classList.toggle('bangla', isBangla(result));
      els.replyEngine.textContent = `${settings.ai.engine} · ${toneLabel(settings.tone, customTones)}`;
      els.replyOut.classList.remove('hidden');
    },
  };
}

function translateTask() {
  return {
    button: els.translateBtn,
    busyLabel: 'Translating…',
    work: async () => {
      const text = els.translateInput.value.trim();
      if (!text) {
        els.translateOut.classList.add('hidden');
        return;
      }
      const { text: result, engine } = await translate(text, { to: targetLang, ai: settings.ai });
      els.translateText.textContent = result;
      els.translateText.classList.toggle('bangla', targetLang === 'bn' || isBangla(result));
      els.translateEngine.textContent = engine;
      els.translateOut.classList.remove('hidden');
    },
  };
}

function updateDirection() {
  els.fromLabel.textContent = targetLang === 'bn' ? 'English' : 'বাংলা';
  els.toLabel.textContent = targetLang === 'bn' ? 'বাংলা' : 'English';
}

async function copyText(text, button) {
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable without focus — leave text selectable */
    }
  }
  const original = button.textContent;
  button.textContent = 'Copied ✓';
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}
