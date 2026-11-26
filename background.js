import { draftReply, getSettings, rephrase, toneLabel, translate } from './api.js';

const MENU_ITEMS = {
  'rt-rephrase': { task: 'rephrase' },
  'rt-draft-reply': { task: 'draft-reply' },
  'rt-to-bn': { task: 'translate-bn' },
  'rt-to-en': { task: 'translate-en' },
};

const COMMAND_TASKS = {
  'rephrase-selection': 'rephrase',
  'draft-reply-selection': 'draft-reply',
  'translate-selection-bn': 'translate-bn',
};

chrome.runtime.onInstalled.addListener(() => {
  // Recreate on every install/update so ids never collide.
  chrome.contextMenus.removeAll(() => {
    const root = chrome.contextMenus.create({
      id: 'rt-root',
      title: 'Rephrase & Translate',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({ id: 'rt-rephrase', parentId: root, title: 'Rephrase "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'rt-draft-reply', parentId: root, title: 'Draft a reply to "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'rt-to-bn', parentId: root, title: 'Translate "%s" to Bangla', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'rt-to-en', parentId: root, title: 'Translate "%s" to English', contexts: ['selection'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const entry = MENU_ITEMS[info.menuItemId];
  const text = (info.selectionText || '').trim();
  if (!entry || !text || typeof tab?.id !== 'number') return;
  runTask(tab.id, info.frameId ?? 0, entry.task, text);
});

// Keyboard shortcuts are the reliable trigger on sites like Discord that
// replace the browser's right-click menu with their own.
chrome.commands.onCommand.addListener(async (command) => {
  const task = COMMAND_TASKS[command];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!task || typeof tab?.id !== 'number') return;

  let text = '';
  try {
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
    text = (result?.result || '').trim();
  } catch {
    return; // page cannot be scripted
  }
  if (text) runTask(tab.id, 0, task, text);
});

async function runTask(tabId, frameId, task, text) {
  // The content script is injected on demand (avoids running on every page).
  try {
    await injectIntoFrame(tabId, frameId);
  } catch (error) {
    console.error('Rephrase & Translate: cannot run on this page.', error);
    return;
  }

  send(tabId, frameId, { type: 'RT_LOADING', task });

  try {
    const settings = await getSettings();
    let result;
    let engine;
    if (task === 'rephrase') {
      result = await rephrase(text, {
        tone: settings.tone,
        customTones: settings.customTones,
        ai: settings.ai,
      });
      engine = settings.ai.ready
        ? `${settings.ai.engine} · ${toneLabel(settings.tone, settings.customTones)}`
        : 'Basic round-trip';
    } else if (task === 'draft-reply') {
      result = await draftReply(text, {
        tone: settings.tone,
        customTones: settings.customTones,
        ai: settings.ai,
      });
      engine = `${settings.ai.engine} · ${toneLabel(settings.tone, settings.customTones)}`;
    } else {
      const translated = await translate(text, {
        to: task === 'translate-bn' ? 'bn' : 'en',
        ai: settings.ai,
      });
      result = translated.text;
      engine = translated.engine;
    }
    send(tabId, frameId, { type: 'RT_RESULT', task, result, engine });
  } catch (error) {
    send(tabId, frameId, { type: 'RT_ERROR', task, message: error.message || String(error) });
  }
}

function send(tabId, frameId, message) {
  chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {});
}

async function injectIntoFrame(tabId, frameId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RT_PING' }, { frameId });
  } catch {
    const target = { tabId, frameIds: [frameId] };
    await chrome.scripting.executeScript({ target, files: ['content/content.js'] });
    await chrome.scripting.insertCSS({ target, files: ['content/content.css'] });
  }
}
