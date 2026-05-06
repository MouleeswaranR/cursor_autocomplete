# Tab Complete

> 🚀 **Extension — Coming Soon on VS Code Marketplace**

**Tab Complete** is a VS Code extension that delivers fast, context-aware AI-powered inline (ghost-text) code completions — completely **free**, using the best open-weight models available today. It streams suggestions from top free-tier LLM providers (OpenRouter, Groq, Fireworks) that offer powerful models at **no cost**, and squeezes maximum performance out of them through a multi-stage intelligent ecosystem: smart context building, AST analysis, LSP integration, multi-layer caching, and edit-intent tracking — all working together so even a free model feels like a premium coding assistant.

> **No paid API required.** OpenRouter, Groq, and Fireworks all offer generous free tiers. Tab Complete is designed from the ground up to get the most out of free models by sending them only the most relevant context — so you get better completions with fewer tokens.

---

## Table of Contents

1. [How It Works — Overview](#how-it-works--overview)
2. [Feature 1 — AI-Powered Inline (Ghost-Text) Completions](#feature-1--ai-powered-inline-ghost-text-completions)
3. [Feature 2 — Smart Context Builder (Prefix Stage)](#feature-2--smart-context-builder-prefix-stage)
4. [Feature 3 — AST-Powered Replacement Region](#feature-3--ast-powered-replacement-region)
5. [Feature 4 — Multi-Layer Completion Caching](#feature-4--multi-layer-completion-caching)
6. [Feature 5 — Continue-Prediction (Type-Ahead Shortcutting)](#feature-5--continue-prediction-type-ahead-shortcutting)
7. [Feature 6 — Edit Intent Tracker](#feature-6--edit-intent-tracker)
8. [Feature 7 — LSP-Aware Local Dependency Resolution](#feature-7--lsp-aware-local-dependency-resolution)
9. [Feature 8 — Multi-Provider LLM Streaming](#feature-8--multi-provider-llm-streaming)
10. [Feature 9 — Live Configuration with Hot-Reload](#feature-9--live-configuration-with-hot-reload)
11. [Extension Settings Reference](#extension-settings-reference)
12. [Supported Languages](#supported-languages)
13. [Getting Started](#getting-started)
14. [Architecture Diagram](#architecture-diagram)

---

## How It Works — Overview

When you stop typing for ~300 ms, Tab Complete's provider pipeline kicks in:

```
User stops typing
       ↓
[Debounce 300ms]
       ↓
[Stage 1] Re-use existing pending suggestion? → YES → return it immediately
       ↓ NO
[Stage 2] Cache hit? → YES → return cached suggestion instantly
       ↓ NO
[Stage 3] User typed part of last prediction? → YES → return remaining suffix instantly
       ↓ NO
[Stage 4] Build smart context prefix (PrefixStage + AST + LSP)
       ↓
[Stage 5] Stream completion from LLM (OpenRouter / Groq / Fireworks)
       ↓
[Stage 6] Store result in cache
       ↓
Display ghost-text inline suggestion
```

This layered pipeline means most suggestions are served from fast local stages (stages 1–3) and only fall through to the LLM when genuinely needed. This is also what makes Tab Complete excel with free models — by the time the LLM is called, it receives a surgically precise context rather than a raw file dump, so even smaller free models produce highly accurate completions.

---

## Feature 1 — AI-Powered Inline (Ghost-Text) Completions

### What it does

Tab Complete registers a native VS Code `InlineCompletionItemProvider` for **every file type** (pattern `**`). As you edit, it shows grey ghost-text suggestions that you can accept by pressing `Tab`.

### How it works internally

The provider (`InlineCompletionProvider`) implements VS Code's `provideInlineCompletionItems` API. It:

1. Receives the current document and cursor position from VS Code.
2. Runs through the full pipeline (debounce → cache → prediction → context → LLM).
3. Returns a `vscode.InlineCompletionList` containing a single `InlineCompletionItem` with the suggested text and an explicit insert range (the replacement region).

### Example

You type:
```typescript
const result = users.filter(u => u.age >
```

Tab Complete sends your file context to the LLM and returns:
```typescript
 30).map(u => u.name);
```

The suggestion appears as grey ghost-text. Press `Tab` to accept.

### Debounce

The provider waits **300 ms** after your last keystroke before doing anything expensive. If you type again before 300 ms, the previous request is discarded and a new one starts. This prevents API spam while you are still typing.

---

## Feature 2 — Smart Context Builder (Prefix Stage)

### What it does

Instead of blindly sending the entire file to the LLM (which wastes tokens and adds noise), Tab Complete builds a **tailored prefix** that includes exactly the code most relevant to what you are writing.

### Three strategies based on cursor position

#### Strategy A — Verbatim prefix (cursor line < 150)
For small files or when you are near the top, the full document text up to the cursor is sent. This is always accurate and fast.

```
[Full file top] → ... → [cursor position]
```

#### Strategy B — Simplified prefix (cursor line ≥ 150, no enclosing function)
When the cursor is deep in a file but not inside a function, the extension:
- Takes the **last 150 lines** before the cursor (the most recent context).
- Extracts which identifiers are used in those lines.
- Filters the import section to only include imports that are actually referenced.

This prevents sending hundreds of stale lines at the top of the file.

#### Strategy C — Scoped prefix (cursor inside a function)

This is the most powerful strategy. It assembles:

| Part | What it contains |
|---|---|
| Used imports | Only the import statements whose bindings appear in the current scope |
| Same-file dependencies | Full source of functions/classes used by the current function (resolved via LSP) |
| Class header | The class name, `extends`, `implements`, field declarations (up to the opening `{`) |
| Function lines | All lines from the function start to the cursor position |

**Small function** (< 150 lines): all lines from the function start to cursor are included.

**Large function** (≥ 150 lines): only the first 30 lines (setup/signature) and the last 100 lines before the cursor are included, with a `// ... [truncated] ...` marker between them. This keeps the LLM focused on what it needs without exceeding token limits.

### Example — Scoped prefix output

```typescript
// Used imports
import { UserService } from './userService';
import { formatName } from '../utils/format';

// Same-file dependency (resolved automatically)
function validateAge(age: number): boolean {
    return age >= 0 && age <= 150;
}

// Class header
class ProfileController extends BaseController {
    private readonly userService: UserService;

    // Function lines up to cursor
    async updateProfile(userId: string, data: ProfileData): Promise<void> {
        const user = await this.userService.findById(userId);
        if (!validateAge(data.age)) {
            throw new Error('Invalid age');
        }
        // ← cursor is here
```

The LLM receives exactly this — no noise, no stale code, no unrelated imports.

---

## Feature 3 — AST-Powered Replacement Region

### What it does

Tab Complete doesn't just complete forward — it computes a **replacement region**: the span of existing text that the new completion should replace. This is especially important for mid-line completions where you are rewriting part of an existing expression.

### How it works

The `ReplacementRegionStage` uses [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) to parse the code and find the end of the current statement, enabling accurate replacements even across multiple lines.

**Step 1 — Find text after cursor**  
It reads everything on the current line after the cursor position.

**Step 2 — Decide if extension is needed**  
Extension is triggered when the text after the cursor has:
- Unbalanced open brackets/braces (e.g. `func(a, b` — unclosed `(`)
- A continuation operator at the end (`,`, `+`, `&&`, `|>`, `?`, `.`, `=>`, etc.)
- No statement terminator (`}`, `)`, `{`, `:`)

**Step 3 — Extend to statement end using AST**  
If extension is needed and the text after cursor is short (< 20 chars), the stage:
1. Reads up to 3 more lines.
2. Parses them with Tree-sitter.
3. Walks the AST to find the smallest node containing the cursor.
4. Walks up the tree to the nearest statement boundary (`expression_statement`, `return_statement`, `variable_declaration`, `if_statement`, etc.).
5. Returns the end position of that statement node.

### Example

Cursor is in the middle of:
```python
result = compute_value(x,
    y + z)
```

Without AST, the replacement region would be just `compute_value(x,` — cutting off mid-expression. With AST, the replacement region correctly spans both lines up to `)`.

### Supported languages for AST

TypeScript, TSX, JavaScript, JSX, Python, Rust, Go, Java, C, C++

---

## Feature 4 — Multi-Layer Completion Caching

### What it does

Tab Complete caches completion results so that when you return to the same position in the same state, the suggestion appears **instantly** without hitting the LLM again.

### Cache key

Each cached entry is keyed on **5 dimensions**:

| Key part | Why it matters |
|---|---|
| Document URI | Different files have different completions |
| Document content hash (MD5) | Detects if the file has been edited since the last cache entry |
| Cursor line | Position matters — different lines need different completions |
| Cursor character | Sub-line position affects the completion |
| Edit history hash | Your recent edits change what the LLM should suggest |

If any of these change, the cache misses and a fresh LLM call is made.

### Underlying cache — BoundedCache (LRU + LFU)

The `BoundedCache<V>` is a generic, fixed-capacity cache that combines **LRU** (Least Recently Used) and **LFU** (Least Frequently Used) eviction:

- Each entry tracks `lastAccessed` timestamp and `accessCount`.
- **Eviction score** = `accessCount / ageInSeconds` — entries with low use frequency and old access time are evicted first.
- **TTL support** — each entry can have an expiry time (configurable via `completionCacheTtlMs`).
- **Group invalidation** — all entries for a closed document are removed at once when VS Code fires `onDidCloseTextDocument`.

### Live config update

If you change `completionCacheMaxEntries` or `completionCacheTtlMs` in settings, the cache rebuilds itself immediately without requiring a reload.

---

## Feature 5 — Continue-Prediction (Type-Ahead Shortcutting)

### What it does

When the LLM returns a multi-token suggestion but you start typing characters that **match** the beginning of that suggestion, Tab Complete skips the LLM entirely and just shows you the **remaining suffix** of the already-predicted text.

### How it works

After a successful LLM completion, the extension remembers:
- `lastCompletionText` — the full predicted string
- `lastCompletionPosition` — where the prediction started
- `lastCompletionUri` — which file it was in

On the next provider call (before any cache or LLM lookup), it computes what text you have typed since the last prediction position, then checks if that typed text is a **prefix** of `lastCompletionText`.

| Situation | What happens |
|---|---|
| Typed text is a prefix of prediction | Return the remaining suffix as new suggestion |
| Typed text fully matches prediction | Clear prediction state, return `null` (accept silently) |
| Typed text diverged | Clear prediction state, fall through to full re-prediction |

### Example

LLM suggests: `users.filter(u => u.isActive).length`

You type `users.filter(` — Tab Complete immediately shows `u => u.isActive).length` without any API call.

---

## Feature 6 — Edit Intent Tracker

### What it does

The `IntentTracker` listens to **every document change** in VS Code and builds a rolling history of what you have been doing. This history is hashed and used as part of the completion cache key, ensuring completions are context-sensitive to your recent activity.

### How it works

**Listening to changes**  
The tracker registers two listeners:
- `onDidChangeTextDocument` — fires on every keystroke/paste/undo.
- `onDidChangeActiveTextEditor` — fires when you switch files.

**Grouping edits into intents**  
Rapid consecutive edits to the same file are grouped into a single `PendingIntent`. A pending intent is **flushed** (finalised) 1.5 seconds after the last activity in that group.

**Classifying edit type**  
Each finalised intent is classified:

| Type | Condition |
|---|---|
| `'pasted'` | A single change inserted more than 50 characters |
| `'added'` | New text was inserted |
| `'edited'` | Text was replaced or deleted |

**Version jump detection**  
If the document version jumps by more than 1 between events (e.g. undo/redo sequences), the pending intent for that file is discarded to avoid tracking stale context.

**Buffer and hash**  
Finalised `IntentEntry` objects accumulate in a rolling `buffer`. At any point, `computeHash()` produces a short (16-char) MD5 fingerprint of the buffer content (file path + timestamp + type + change text). This hash invalidates the completion cache whenever your recent edit context changes.

### Example

You paste a large block of code → intent classified as `'pasted'`, hash changes → next completion call is a cache miss → LLM is called with fresh context that knows what you just pasted.

---

## Feature 7 — LSP-Aware Local Dependency Resolution

### What it does

When building the scoped prefix, Tab Complete uses VS Code's built-in Language Server Protocol (LSP) commands to **resolve definitions** of identifiers used at the cursor and automatically pulls the full source of same-file symbols into the context.

### How it works

**Step 1 — Extract identifiers**  
The `extractIdentifiers` utility uses regex-based heuristics tuned per language to collect all symbol names used in the current scope (class header + function lines).

**Step 2 — Resolve definitions via LSP**  
For each identifier, `LSPService.executeDefinitionProvider()` is called (equivalent to pressing `F12` in VS Code). This returns the file URI and position of the definition.

**Step 3 — Filter to same-file symbols**  
Only definitions in the **same file** are included — external libraries are already covered by import statements.

**Step 4 — Retrieve full symbol text**  
For each resolved same-file symbol, the document symbol provider is used to find the full range of the function or class definition, and its complete source text is extracted.

**LSP caching**  
All LSP calls are cached in a `BoundedCache` keyed by document URI + position. The cache is invalidated when the document changes (`onDidChangeTextDocument`) or is closed (`onDidCloseTextDocument`). If you change `lspCacheMaxEntries` in settings, the cache rebuilds itself live.

### Example

Your function calls `validateAge` and `formatDate` — both defined elsewhere in the same file. Tab Complete automatically includes their full source in the prefix, so the LLM knows their signatures and behaviour when generating your completion.

---

## Feature 8 — Multi-Provider LLM Streaming

### What it does

Tab Complete supports three LLM providers and automatically selects whichever one has an API key configured. All providers use an identical OpenAI-compatible streaming API, and completions are streamed token-by-token for the fastest possible first-token latency.

### Providers

All three supported providers offer **free tiers** — no credit card required to get started:

| Provider | Default model | Free tier | Notes |
|---|---|---|---|
| **OpenRouter** | `qwen/qwen3-32` | ✅ Free models available | Default and recommended — access to hundreds of open-weight models, many completely free |
| **Groq** | `qwen/qwen3-32` | ✅ Free tier included | Ultra-fast inference on dedicated hardware — often the fastest free option |
| **Fireworks** | `qwen/qwen3-32` | ✅ Free tier included | Fast serverless inference for open-weight models |

**Provider selection** — The extension checks keys in this order: OpenRouter → Groq → Fireworks. The first provider with a non-empty API key is used.

### Streaming mechanics

1. A `fetch` POST is sent with `"stream": true` to the provider's chat completions endpoint.
2. The response body is read chunk-by-chunk using the Streams API (`ReadableStream.getReader()`).
3. Each chunk is decoded (`TextDecoder`) and split on newlines into SSE data lines.
4. Lines starting with `data: ` are parsed as `ChatStreamChunk` (OpenAI SSE format).
5. `choices[0].delta.content` from each chunk is yielded from an `AsyncGenerator<string>`.
6. Streaming stops on the `[DONE]` sentinel.

### Cancellation

Every in-flight request is tracked with an `AbortController`. When:
- VS Code cancels the completion token (user typed again)
- A newer request supersedes the current one

…the `AbortController.abort()` is called immediately, terminating the `fetch` and stopping streaming. This ensures no stale completions arrive from old requests.

### LLM prompt

The LLM is given a tightly constrained system prompt:

```
You are a code autocomplete engine.
Rules:
- Complete the current line of code
- Return meaningful continuation (not single characters)
- Do not return partial tokens
- Prefer full expressions like function calls
- No explanations
```

Temperature is set to `0.1` for deterministic, code-appropriate outputs.

---

## Feature 9 — Live Configuration with Hot-Reload

### What it does

All settings are applied **immediately** when you change them in VS Code's settings UI — no reload required. The `ConfigurationService` singleton notifies all subscribed components (cache, LSP service, API client) so they adapt in real time.

### How it works

- `ConfigurationService` uses `vscode.workspace.onDidChangeConfiguration` to detect changes in the `tab-completion` namespace.
- When a change is detected, `loadConfig()` is called to re-read all values.
- Each registered listener (subscriber) is called with the new config object.
- `ApiClient`, `CompletionCache`, and `LSPService` all subscribe and react:
  - `CompletionCache` rebuilds itself with a new `BoundedCache` if size or TTL changed.
  - `LSPService` rebuilds its cache if max entries changed.
  - `ApiClient` always reads the live config on each request — no state to update.

---

## Extension Settings Reference

Configure under **Settings → Tab Completion** or in `settings.json`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `tab-completion.openrouterApiKey` | string | `""` | API key for OpenRouter (recommended default provider) |
| `tab-completion.groqApiKey` | string | `""` | API key for Groq |
| `tab-completion.fireworksApiKey` | string | `""` | API key for Fireworks |
| `tab-completion.model` | string | `"qwen/qwen3-32"` | LLM model name to use for completions |
| `tab-completion.maxTokens` | number | `500` | Maximum tokens to generate per completion (50–5000) |
| `tab-completion.completionCacheMaxEntries` | number | `100` | Maximum number of completions to keep in cache (10–1000) |
| `tab-completion.completionCacheTtlMs` | number | `30000` | How long (in milliseconds) a cached completion stays valid (5000–120000) |
| `tab-completion.lspCacheMaxEntries` | number | `100` | Maximum number of LSP results to cache (10–1000) |

### Minimal setup — `settings.json`

```json
{
    "tab-completion.openrouterApiKey": "sk-or-...",
    "tab-completion.model": "qwen/qwen3-32",
    "tab-completion.maxTokens": 500
}
```

---

## Supported Languages

Full AST-powered replacement regions and scoped prefix support:

| Language | Grammar |
|---|---|
| TypeScript | ✅ |
| TypeScript React (TSX) | ✅ |
| JavaScript | ✅ |
| JavaScript React (JSX) | ✅ |
| Python | ✅ |
| Rust | ✅ |
| Go | ✅ |
| Java | ✅ |
| C | ✅ |
| C++ | ✅ |

All other languages receive verbatim or simplified prefix completions (no AST, but still fully functional).

---

## Getting Started

### 1. Install the extension

> 🚀 **Coming Soon on VS Code Marketplace** — stay tuned!

Once released, install directly from the VS Code Extensions panel by searching **"Tab Complete"**.

### 2. Get a free API key

All providers below have **free tiers** — pick one and create a free account:

- **OpenRouter** (recommended — free models available): [openrouter.ai/keys](https://openrouter.ai/keys)
- **Groq** (free tier, very fast): [console.groq.com/keys](https://console.groq.com/keys)
- **Fireworks** (free tier): [fireworks.ai](https://fireworks.ai)

### 3. Add your API key to VS Code settings

Open **Settings** (`Ctrl+,`) → search `Tab Completion` → paste your key.

Or add to `settings.json`:

```json
{
    "tab-completion.openrouterApiKey": "your-key-here"
}
```

### 4. Start coding

Open any file, start typing, and wait ~300 ms. Ghost-text suggestions will appear automatically. Press `Tab` to accept.

---

## Architecture Diagram

```
extension.ts (entry point)
│
└── InlineCompletionProvider          ← registers for all files (**)
        │
        ├── ApiClient                 ← streams completions from OpenRouter / Groq / Fireworks
        │       └── AbortController   ← cancels stale requests instantly
        │
        ├── IntentTracker             ← records edit history, produces cache-invalidation hash
        │
        ├── CompletionCache           ← LRU+LFU bounded cache (keyed by content + position + intent hash)
        │       └── BoundedCache<V>   ← generic fixed-capacity cache with TTL and group invalidation
        │
        └── ContextGatherer           ← coordinates context building
                │
                ├── PrefixStage       ← smart prefix: verbatim / simplified / scoped
                │       ├── Import filter         ← only used imports
                │       ├── LocalDependencyResolver ← same-file symbol resolution via LSP
                │       └── LSPService            ← wraps VS Code LSP commands with caching
                │
                └── ReplacementRegionStage ← AST-powered replacement range calculation
                        └── ASTService    ← Tree-sitter parser (TypeScript, Python, Rust, Go, Java, C, C++)

ConfigurationService  ← singleton; hot-reloads all settings; notifies all subscribers
```

---

## Release Notes

### 0.0.1

Initial release:
- AI-powered inline completions via OpenRouter, Groq, and Fireworks
- Smart scoped/simplified/verbatim prefix builder
- AST-powered replacement region using Tree-sitter
- Multi-layer completion caching (LRU+LFU with TTL)
- Continue-prediction type-ahead shortcutting
- Edit intent tracking with cache invalidation
- LSP-aware local dependency resolution
- Multi-provider streaming with cancellation
- Live configuration hot-reload

---

## License

MIT

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
