# Rephrase & Bangla Translator (Chrome Extension)

Rephrase any selected text and translate English ⇄ Bangla from anywhere on the web.

## Features

- **Right-click menu** on any selected text:
  - *Rephrase selection*
  - *Draft a reply to selection* (AI writes a chat reply in the message's language)
  - *Translate selection to Bangla* / *to English*

  The result appears in a small floating card next to the selection with
  **Copy** and **Insert into chat** buttons. *Insert into chat* types the text
  into the message box of Discord, Slack, WhatsApp Web and similar apps;
  *Replace selection* is also offered when the selected text is editable.
- **Keyboard shortcuts** (work everywhere, even on sites like Discord that
  replace the browser's right-click menu):
  - <kbd>Alt+Shift+R</kbd> — rephrase the selection
  - <kbd>Alt+Shift+D</kbd> — draft a reply to the selected message
  - <kbd>Alt+Shift+B</kbd> — translate the selection to Bangla

  Change them at `chrome://extensions/shortcuts`.
- **Toolbar popup** with three tabs:
  - *Rephrase* with tone options (Standard / Formal / Casual / Simple / Concise)
  - *Reply* — paste a message, get a drafted reply
  - *Translate* with an English ⇄ বাংলা direction switch
  - The popup auto-fills with whatever text is selected on the current page.
- **Custom tones** — save named tone presets with your own prompt (see below).
- **Works with zero setup** — translation uses Google Translate's free endpoint,
  and automatically falls back to your AI model when the free service is
  rate-limited (HTTP 429) or down. Replying and high-quality rephrasing need an
  AI provider (see below).

### AI providers (for rephrasing, reply drafting & translation backup)

Pick any provider in Settings (⚙ → *Provider*):

| Provider | Default model | Where to get a key |
|---|---|---|
| Google Gemini | `gemini-3.6-flash` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier) |
| OpenAI | `gpt-5-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| DeepSeek | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| Grok (xAI) | `grok-4.1-fast` | [console.x.ai](https://console.x.ai) |
| Custom / Local | any | no key needed for local servers |

Everything except Gemini speaks the OpenAI-compatible chat API, so any server
works: Ollama, LM Studio, llama.cpp, vLLM, LiteLLM, OpenRouter…

- **Model names**: type any model id, or click **Load models** to fetch the
  server's live list and pick from it. Each provider remembers its own key and
  model. **Test** sends a one-word ping to verify the setup.
- **Local LLMs (Ollama / LM Studio)**: choose *Custom / Local LLM*, set the
  server URL (`http://localhost:11434/v1` for Ollama,
  `http://localhost:1234/v1` for LM Studio), load models, pick one, Save.
  For Ollama, start it with `OLLAMA_ORIGINS=chrome-extension://*` so the
  extension is allowed to connect; for LM Studio enable CORS in server
  settings. Chrome will ask to allow access to the server once.
- Without any provider, rephrasing still works in **Basic mode** (a translate
  round-trip) and translation always works — reply drafting needs an AI model.

Keys are stored only in your browser (`chrome.storage.local`) and are sent
only to the provider you choose.

**Gemini model names:** Google periodically retires Gemini model names. The
extension tries the current one first and, when the API returns a 404,
automatically switches to whatever replacement model the error message names.

### Custom tones

Settings (⚙) → **Custom tones** lets you save named tone presets, each with its
own prompt. For example:

- **Name:** `Jermaine Griggs`
- **Prompt:** `Rephrase in Jermaine Griggs' voice, in a helpful and polite way.`

Saved tones appear in the **Tone** menu of the *Rephrase* and *Reply* tabs and
are also applied when you use the right-click menu or the keyboard shortcuts.
Rephrase uses the prompt as the instruction; Reply uses it as the style for the
drafted reply.

Tones are stored in `chrome.storage.local` (`customTones`). If you delete a tone
that is currently selected — or leave its prompt empty — the extension falls
back to **Standard**. Custom tones need an AI provider; without one, rephrasing
still works in Basic mode.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

## Notes & limitations

- **Discord:** use Discord in the browser (discord.com in Chrome) — the Discord
  desktop app does not support Chrome extensions. Because Discord replaces the
  browser's right-click menu with its own, use the <kbd>Alt+Shift+D</kbd>
  shortcut there: select the message, press the shortcut, click
  *Insert into chat*.
- Does not run on `chrome://` pages, the Chrome Web Store, or the built-in PDF viewer.
- Text longer than 5000 characters is trimmed per request.
- The free translation endpoint is unofficial; if Google changes it, translation
  may stop working.

## Project layout

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker: context menus, API calls, on-demand injection |
| `api.js` | Shared translate/rephrase backends |
| `content/` | Floating result card injected into pages |
| `popup/` | Toolbar popup UI |
| `options/` | Settings page (Gemini API key) |
| `icons/` | Icons + `generate.py` (pure-stdlib regenerator) |
