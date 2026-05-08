# Installation & Setup Guide

> 📄 Also available on GitHub: [**View SETUP.md on GitHub**](https://github.com/MouleeswaranR/cursor_autocomplete/blob/main/SETUP.md)

## Step 1 — Install the Extension

### From VS Code Marketplace (Recommended)

1. Open **VS Code**
2. Click the **Extensions** icon in the left sidebar (or press `Ctrl+Shift+X`)
3. In the search box, type **`Tab Complete`**
4. Find **"Nesha - AI Tab Completion"** by `moulee777`
5. Click **Install**

Or install directly from the browser:
👉 [**Open in VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=moulee777.tab-complete)

### From a `.vsix` file (Offline)

1. Download the `.vsix` file
2. Open VS Code
3. Press `Ctrl+Shift+P` → type **"Install from VSIX"** → press Enter
4. Browse to the `.vsix` file and select it
5. Click **Install**

---

## Step 2 — Get a Free API Key

You need **one** API key from any of the three supported providers. All have free tiers — no credit card required.

### Option A — OpenRouter (Recommended)

OpenRouter gives you access to hundreds of free open-weight models including `qwen/qwen3-32`.

1. Go to [**openrouter.ai**](https://openrouter.ai)
2. Click **Sign In** (top right) → create a free account
3. After signing in, go to [**openrouter.ai/keys**](https://openrouter.ai/keys)
4. Click **Create Key**
5. Give it a name (e.g. `vscode-tab-complete`) and click **Create**
6. Copy the key — it starts with `sk-or-...`

> ⚠️ Copy the key immediately — it won't be shown again.

### Option B — Groq (Very Fast)

Groq offers ultra-fast free inference.

1. Go to [**console.groq.com**](https://console.groq.com)
2. Sign up for a free account
3. Go to **API Keys** in the left sidebar
4. Click **Create API Key**
5. Copy the key — it starts with `gsk_...`

### Option C — Fireworks AI

1. Go to [**fireworks.ai**](https://fireworks.ai)
2. Sign up for a free account
3. Go to **API Keys** in your account settings
4. Click **Create API Key** and copy it

---

## Step 3 — Add Your API Key to VS Code Settings

### Method A — Settings UI (Easiest)

1. Open VS Code
2. Press `Ctrl+,` to open **Settings**
3. In the search box at the top, type **`tab completion`**
4. You will see the Tab Completion settings section:

   | Setting | What to do |
   |---------|-----------|
   | **OpenRouter Api Key** | Paste your OpenRouter key here |
   | **Groq Api Key** | Paste your Groq key here (if using Groq) |
   | **Fireworks Api Key** | Paste your Fireworks key here (if using Fireworks) |
   | **Model** | Leave as `qwen/qwen3-32` or change to any model your provider supports |
   | **Max Tokens** | Default `500` is fine for most cases |

5. Press `Enter` or click outside the field — settings save automatically

### Method B — settings.json (Advanced)

1. Press `Ctrl+Shift+P` → type **"Open User Settings JSON"** → press Enter
2. Add the following inside the `{}`:

   **Using OpenRouter:**
   ```json
   {
       "tab-completion.openrouterApiKey": "sk-or-YOUR_KEY_HERE",
       "tab-completion.model": "qwen/qwen3-32",
       "tab-completion.maxTokens": 500
   }
   ```

   **Using Groq:**
   ```json
   {
       "tab-completion.groqApiKey": "gsk_YOUR_KEY_HERE",
       "tab-completion.model": "qwen/qwen3-32",
       "tab-completion.maxTokens": 500
   }
   ```

   **Using Fireworks:**
   ```json
   {
       "tab-completion.fireworksApiKey": "YOUR_KEY_HERE",
       "tab-completion.model": "accounts/fireworks/models/qwen3-32b",
       "tab-completion.maxTokens": 500
   }
   ```

3. Save the file (`Ctrl+S`)

> The extension reads settings live — no restart required.

---

## Step 4 — Start Using Tab Complete

1. Open any code file (TypeScript, Python, JavaScript, etc.)
2. Open the **Output** panel (`Ctrl+Shift+U`) → select **Tab completion** from the dropdown to confirm the extension is running and watch for any errors in real time
3. Make sure VS Code's built-in inline completions are set to use Tab Complete:
   - Press `Ctrl+,` to open **Settings**
   - Search **`editor.inlineSuggest`** and ensure **Inline Suggest: Enabled** is checked
   - Search **`editor.tabCompletion`** and set it to **`on`** so the `Tab` key accepts suggestions
4. Start typing some code
5. **Wait ~300 ms** after you stop typing
6. A grey ghost-text suggestion will appear inline

### Accepting a suggestion

| Action | Keyboard shortcut |
|--------|------------------|
| Accept full suggestion | `Tab` |
| Dismiss suggestion | `Escape` |
| Keep typing to refine | Just continue typing |

---

## All Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `tab-completion.openrouterApiKey` | string | `""` | API key for OpenRouter |
| `tab-completion.groqApiKey` | string | `""` | API key for Groq |
| `tab-completion.fireworksApiKey` | string | `""` | API key for Fireworks |
| `tab-completion.model` | string | `qwen/qwen3-32` | Model name to use |
| `tab-completion.maxTokens` | number | `500` | Max tokens per completion (50–5000) |
| `tab-completion.completionCacheMaxEntries` | number | `100` | Max cached completions (10–1000) |
| `tab-completion.completionCacheTtlMs` | number | `30000` | Cache entry lifetime in ms (5000–120000) |
| `tab-completion.lspCacheMaxEntries` | number | `100` | Max LSP cache entries (10–1000) |

---

## Troubleshooting

### No suggestions appearing

- Check that an API key is set in settings (`Ctrl+,` → search `tab completion`)
- Open the **Output** panel (`Ctrl+Shift+U`) → select **Tab completion** from the dropdown
- Look for error messages like `[APIError]` or `Missing API key`

### Suggestions are slow

- Try **Groq** — it is the fastest free option
- Reduce `tab-completion.maxTokens` to `200–300`

### Wrong indentation in Python suggestions

- This is a known edge case with some models — the model occasionally omits leading spaces on continuation lines
- Try switching to a different model via `tab-completion.model`

### API key not working

- Make sure there are no extra spaces around the key
- Verify the key is active in your provider's dashboard
- Check the Output panel for the exact error from the API
