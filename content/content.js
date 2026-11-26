// Injected on demand by the service worker when the user picks a context-menu
// action. Shows a small floating card with the result next to the selection.
(() => {
  if (window.__rtInjected) return;
  window.__rtInjected = true;

  const TASK_LABELS = {
    rephrase: 'Rephrased text',
    'draft-reply': 'Reply draft',
    'translate-bn': 'Bangla translation',
    'translate-en': 'English translation',
  };

  let panel = null;
  let lastResult = '';
  // { kind: 'field', element, start, end } | { kind: 'editable', range } | null
  let replaceTarget = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RT_PING') {
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'RT_LOADING') showPanel(message.task, { loading: true });
    if (message?.type === 'RT_RESULT') showPanel(message.task, { result: message.result, engine: message.engine });
    if (message?.type === 'RT_ERROR') showPanel(message.task, { error: message.message });
  });

  // --- selection helpers ---------------------------------------------------

  function editableFromRange(range) {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== document.documentElement) {
      if (node.isContentEditable) return node;
      node = node.parentElement;
    }
    return null;
  }

  function readSelection() {
    // Selections inside <input>/<textarea> are not exposed via
    // window.getSelection(), so check the focused field first.
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (start != null && end != null && start !== end) {
        const text = active.value.slice(start, end);
        if (text.trim()) {
          return {
            text,
            rect: active.getBoundingClientRect(),
            replaceTarget: { kind: 'field', element: active, start, end },
          };
        }
      }
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const text = selection.toString();
      if (text.trim()) {
        const range = selection.getRangeAt(0);
        const editable = editableFromRange(range);
        return {
          text,
          rect: range.getBoundingClientRect(),
          replaceTarget: editable ? { kind: 'editable', range: range.cloneRange() } : null,
        };
      }
    }
    return null;
  }

  // --- panel ----------------------------------------------------------------

  function showPanel(task, { loading = false, result = '', engine = '', error = '' } = {}) {
    removePanel();
    const selection = readSelection();
    lastResult = result;
    replaceTarget = !loading && !error && selection ? selection.replaceTarget : null;

    panel = document.createElement('div');
    panel.className = loading ? 'rt-panel rt-loading' : 'rt-panel';

    const header = document.createElement('div');
    header.className = 'rt-header';
    const title = document.createElement('span');
    title.className = 'rt-title';
    title.textContent = loading
      ? task === 'rephrase' ? 'Rephrasing…' : 'Translating…'
      : TASK_LABELS[task] || 'Result';
    const engineTag = document.createElement('span');
    engineTag.className = 'rt-engine';
    engineTag.textContent = engine;
    const close = document.createElement('button');
    close.className = 'rt-close';
    close.textContent = '✕';
    close.title = 'Close (Esc)';
    close.addEventListener('click', removePanel);
    header.append(title, engineTag, close);

    const body = document.createElement('div');
    body.className = 'rt-body';
    if (loading) {
      const spinner = document.createElement('span');
      spinner.className = 'rt-spinner';
      body.append(spinner);
    } else if (error) {
      body.classList.add('rt-error');
      body.textContent = error;
    } else {
      body.textContent = result;
      if (/[\u0980-\u09FF]/.test(result)) body.classList.add('rt-bangla');
    }

    panel.append(header, body);

    if (!loading && !error) {
      const actions = document.createElement('div');
      actions.className = 'rt-actions';
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      keepSelectionOnMousedown(copy);
      copy.addEventListener('click', () => copyResult(copy));
      actions.append(copy);
      const insert = document.createElement('button');
      insert.textContent = 'Insert into chat';
      keepSelectionOnMousedown(insert);
      insert.addEventListener('click', () => insertResult(insert));
      actions.append(insert);
      if (task === 'rephrase' && replaceTarget) {
        const replace = document.createElement('button');
        replace.textContent = 'Replace selection';
        keepSelectionOnMousedown(replace);
        replace.addEventListener('click', replaceSelection);
        actions.append(replace);
      }
      panel.append(actions);
    }

    (document.body || document.documentElement).appendChild(panel);
    positionPanel(selection ? selection.rect : null);

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);
  }

  // Without this, clicking a button moves focus and some pages drop the
  // selection we still need for "Replace selection".
  function keepSelectionOnMousedown(button) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  }

  function positionPanel(rect) {
    if (!panel) return;
    const margin = 8;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let top;
    let left;
    if (rect && (rect.width || rect.height)) {
      left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewW - panel.offsetWidth - margin));
      top = rect.bottom + margin;
      if (top + panel.offsetHeight > viewH - margin) {
        top = Math.max(margin, rect.top - panel.offsetHeight - margin);
      }
    } else {
      left = Math.max(margin, (viewW - panel.offsetWidth) / 2);
      top = Math.max(margin, viewH * 0.2);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  async function copyResult(button) {
    try {
      await navigator.clipboard.writeText(lastResult);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = lastResult;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      (document.body || document.documentElement).appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    const original = button.textContent;
    button.textContent = 'Copied ✓';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }

  function replaceSelection() {
    if (!replaceTarget) return;
    if (replaceTarget.kind === 'field') {
      const el = replaceTarget.element;
      el.focus();
      el.setRangeText(lastResult, replaceTarget.start, replaceTarget.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const editable = editableFromRange(replaceTarget.range);
      if (!editable) return;
      editable.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(replaceTarget.range);
      if (!document.execCommand('insertText', false, lastResult)) {
        replaceTarget.range.deleteContents();
        replaceTarget.range.insertNode(document.createTextNode(lastResult));
      }
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
    removePanel();
  }

  // --- insert into a chat composer -------------------------------------------

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Finds the message box of the current chat app: Discord labels its
  // composer "Message #channel" / "Message @user"; Slack, WhatsApp Web and
  // similar use a contenteditable textbox. Falls back to the lowest visible
  // editable on the page (chat composers sit at the bottom).
  function findChatBox() {
    const discord = document.querySelector('textarea[aria-label^="Message"]');
    if (discord && isVisible(discord) && !discord.disabled) return discord;

    const editables = Array.from(
      document.querySelectorAll('div[contenteditable="true"][role="textbox"], textarea')
    )
      .filter(isVisible)
      .filter((el) => !el.readOnly && !el.disabled);
    if (!editables.length) return null;
    return editables.sort(
      (a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom
    )[0];
  }

  function insertIntoChat(text) {
    const box = findChatBox();
    if (!box) return false;
    box.focus();
    let inserted = false;
    if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
      const end = box.value.length;
      box.setSelectionRange(end, end);
      // execCommand fires the native input events that React-based apps
      // (Discord) listen for; setRangeText is the fallback.
      inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        box.setRangeText(text, end, end, 'end');
        box.dispatchEvent(new Event('input', { bubbles: true }));
        inserted = true;
      }
    } else if (box.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        box.appendChild(document.createTextNode(text));
        box.dispatchEvent(new Event('input', { bubbles: true }));
        inserted = true;
      }
    }
    return inserted;
  }

  async function insertResult(button) {
    const original = button.textContent;
    if (insertIntoChat(lastResult)) {
      button.textContent = 'Inserted ✓';
    } else {
      // No chat input on this page — at least put the text on the clipboard.
      try {
        await navigator.clipboard.writeText(lastResult);
      } catch {
        /* clipboard unavailable — leave the panel open so the text can be copied manually */
      }
      button.textContent = 'Copied ✓ (no chat box)';
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  function onKey(event) {
    if (event.key === 'Escape') removePanel();
  }

  function onOutside(event) {
    if (panel && !panel.contains(event.target)) removePanel();
  }

  function removePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
  }
})();
