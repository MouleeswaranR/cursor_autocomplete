# Tab-Complete Extension — Implementation Reference

## Overview

`tab-complete` is a VS Code extension that provides AI-powered inline (ghost-text) code completions. It streams completions from LLM APIs (OpenRouter, Groq, Fireworks), uses a multi-stage caching and context-building pipeline, and tracks user edit intent to avoid unnecessary API calls.

---

## Architecture

```
extension.ts (entry point)
│
└── InlineCompletionProvider  (providers/)
        ├── ApiClient          (api/)
        ├── IntentTracker      (services/)
        ├── CompletionCache    (cache/)
        └── ContextGatherer    (services/)
                ├── PrefixStage  (services/contextStages/)
                │       └── LocalDependencyResolver
                └── LSPService   (services/)

ConfigurationService  (services/) — singleton, shared across all components
BoundedCache          (cache/)    — low-level LRU+LFU generic cache
```

---

## Entry Point — `src/extension.ts`

**What it does:**
- Creates a named VS Code output channel (`"Tab completion"`) for logging.
- Instantiates `InlineCompletionProvider` and passes the channel to it.
- Registers the provider for **all files** using `{ pattern: "**" }`.
- Pushes the provider disposable, output channel, and provider itself into `context.subscriptions` so everything is cleaned up on deactivation.

```
activate()
  → create outputChannel
  → new InlineCompletionProvider(outputChannel)
  → registerInlineCompletionItemProvider({ pattern:"**" }, provider)
  → context.subscriptions.push(...)
```

---

## Configuration — `src/services/configurationService.ts`

**Pattern:** Singleton via `ConfigurationService.getInstance()` / `getConfig()`.

### `TabCompletionConfig` interface

| Field | Type | Default | Purpose |
|---|---|---|---|
| `fireworksApiKey` | string | `''` | API key for Fireworks |
| `groqApiKey` | string | `''` | API key for Groq |
| `openrouterApiKey` | string | `''` | API key for OpenRouter |
| `model` | string | `'qwen/qwen-32b'` | LLM model name |
| `maxTokens` | number | `500` | Max tokens per completion |
| `completionCacheTtlMs` | number | `30000` | Completion cache TTL (ms) |
| `completionCacheMaxEntries` | number | `100` | Max completion cache size |
| `lspCacheMaxEntries` | number | `100` | Max LSP cache size |

### Key Mechanics

- **`loadConfig()`** — reads from `vscode.workspace.getConfiguration('tab-completion')` with fallback defaults.
- **`registerConfigChangeListener()`** — called from the constructor; hooks `vscode.workspace.onDidChangeConfiguration`. When the `tab-completion` namespace changes it reloads config and calls `notifyListeners()`.
- **`onConfigChange(callback)`** — public API for other services to subscribe to live config updates. Returns a `Disposable` to unsubscribe. Internally stores callbacks in a `Set<>`.
- **`notifyListeners()`** — iterates `changeListeners` and calls each one with fresh config.
- **`dispose()`** — disposes all registered VS Code disposables and clears the listener set.
- **`getConfig()`** — module-level shortcut for `ConfigurationService.getInstance()`.

---

## API Client — `src/api/apiClient.ts`

**Purpose:** Sends chat-completion requests to the active LLM provider and returns an `AsyncGenerator<string>` that yields streamed content chunks.

### Provider Selection

```
getActiveProvider()
  → checks openrouterApiKey → groqApiKey → fireworksApiKey
  → returns first provider whose key is set, or null
```

`PROVIDER_CONFIGS` maps each `ApiProvider` (`'openrouter' | 'groq' | 'fireworks'`) to:
- `endpoint` — chat completions URL
- `getApiKey()` — reads live config
- `getModel()` — reads live config

### `complete(messages)` flow

1. Calls `getActiveProvider()` — throws if no key configured.
2. Cancels any in-flight request (`this.cancel()`).
3. Creates a fresh `AbortController` stored as `pendingRequest`.
4. Reads `maxTokens`, `model`, endpoint, API key from config.
5. Builds the request body (`model`, `messages`, `max_tokens`, `stream:true`, `temperature:0.1`).
6. Returns `this.streamRequest(...)`.

### `streamRequest()` — SSE streaming

- Makes a `fetch` POST with `Authorization: Bearer <key>`, `Content-Type: application/json`, and the `AbortSignal`.
- Reads the response body chunk-by-chunk using `ReadableStream.getReader()` + `TextDecoder`.
- Buffers partial lines; splits on `\n`; processes lines starting with `"data: "`.
- Parses each data line as `ChatStreamChunk` (OpenAI-compatible SSE format).
- Yields `choices[0].delta.content` for each chunk.
- Stops on `[DONE]` sentinel.
- Releases the reader lock in `finally`.

### `cancel()`
Calls `pendingRequest.abort()` and nulls the reference, aborting the in-flight `fetch`.

---

## Inline Completion Provider — `src/providers/inlineCompletionProvider.ts`

**Implements:** `vscode.InlineCompletionItemProvider`

### Fields

| Field | Purpose |
|---|---|
| `apiClient` | Makes LLM calls |
| `intentTracker` | Tracks edit history, computes hash for cache keys |
| `completionCache` | Stores recent completions |
| `contextGatherer` | Builds the prefix/context sent to the LLM |
| `pendingCompletion` | The last active inline suggestion |
| `lastCompletionText/Position/Uri` | Used for continue-prediction logic |
| `debounceMs = 300` | Minimum ms between provider invocations |

### `provideInlineCompletionItems()` — pipeline

```
1. Debounce check (300 ms)
2. Early return if token.isCancellationRequested
3. handleExistingPendingCompletion()   → reuse last suggestion if cursor unchanged
4. tryCachedCompletion()               → return from CompletionCache if hit
5. tryContinuePrediction()             → extend previous suggestion if user is typing along
6. contextGatherer.gatherContext()     → build smart prefix (PrefixStage)
7. callCompletionApi()                 → stream from LLM via ApiClient
8. completionCache.set()               → store result
9. activateCompletion()                → return InlineCompletionList
```

### Stage Details

**`handleExistingPendingCompletion()`**
- If the document URI or line changed → clears pending and returns `undefined` (proceed).
- If character position is same → returns the cached suggestion text (avoids double LLM call).

**`tryCachedCompletion()`**
- Calls `completionCache.get(document, position, intentHash)`.
- On hit: calls `activateCompletion()` with the cached edit.

**`tryContinuePrediction()`**
- Compares how much of `lastCompletionText` the user has typed since `lastCompletionPosition`.
- If typed text is a prefix of the predicted text → returns the remaining suffix.
- If fully typed → clears prediction state, returns `null`.
- If diverged (user typed something else) → clears and returns `undefined` (re-predict).

**`callCompletionApi()`**
- Sends a system + user chat message to `apiClient.complete()`.
- Iterates the `AsyncGenerator`, respecting `token.isCancellationRequested` (calls `apiClient.cancel()` on cancellation).
- Returns the accumulated string trimmed.

**`activateCompletion()`**
- Updates `lastCompletionText`, `lastCompletionPosition`, `lastCompletionUri`, and `pendingCompletion`.
- Returns a `vscode.InlineCompletionList` with one item.

---

## Context Gatherer — `src/services/contextGatherer.ts`

Coordinates context building. Currently:
- Serializes `IntentTracker` edit history (available but not yet injected into the prompt).
- Delegates to `PrefixStage.buildPrefix()` and returns the result.

---

## Prefix Stage — `src/services/contextStages/prefixStage.ts`

Builds the smart code prefix sent to the LLM. Adapts to file/function size.

### `buildPrefix()` routing

| Condition | Strategy |
|---|---|
| Cursor line < 150 | `getVerbatimPrefix()` — full file text up to cursor |
| No enclosing function | `buildSimplifiedPrefix()` — last 150 lines + filtered imports |
| Enclosing function found | `buildScopedPrefix()` — class header + function lines + imports + same-file deps |

### `buildScopedPrefix()` — Small vs Large Functions

**Small function** (`< 150 lines from function start`):
1. Collect class header lines (up to opening `{` or `:`).
2. Collect all lines from function start to cursor.
3. Extract identifiers → filter used imports → resolve same-file dependencies.
4. Assemble: `[imports, same-file deps, class header, function lines]`.

**Large function** (`>= 150 lines from function start`):
1. Take first 30 lines of the function (setup/signature).
2. Take last 100 lines before cursor (recent context).
3. Extract identifiers from those + class header.
4. Assemble with a truncation marker between setup and recent context.

### Import Filtering (`getUsedImports`)
- Finds import line spans in the source.
- Parses import bindings (identifiers imported).
- Only includes imports whose bound identifiers appear in the code being sent.

### Local Dependency Resolution (`LocalDependencyResolver`)
- Uses `LSPService` to find definitions of identifiers used in scope.
- Collects same-file symbol definitions (classes, functions) that are referenced at cursor.

---

## LSP Service — `src/services/lspService.ts`

Wraps VS Code's built-in language server commands with caching.

### Features

- **`getDocumentSymbols(document)`** — executes `vscode.executeDocumentSymbolProvider`; caches by document URI.
- **`getSuperTypedNames(document, position)`** — executes `vscode.prepareTypedHierarchy` + `vscode.provideSuperTypes`; caches by document URI + position; returns unique parent type names.
- **Cache invalidation** — listens to `onDidChangeTextDocument` and `onDidCloseTextDocument`; invalidates all cache entries grouped by document URI.
- **Live config updates** — subscribes to `configService.onConfigChange`; rebuilds the `BoundedCache` if `lspCacheMaxEntries` changes.

---

## Intent Tracker — `src/services/intentTracker.ts`

Tracks the user's edit history to understand what they are working on.

### How it works

- Listens to `onDidChangeTextDocument` and `onDidChangeActiveTextEditor`.
- Groups rapid edits into a `PendingIntent` (flushed 1.5 s after last activity).
- Classifies each intent as `'added'`, `'edited'`, or `'pasted'` (paste = change text > 50 chars).
- Finalised intents are added to a rolling `buffer` of `IntentEntry[]`.

### `computeHash()`
Creates an MD5 hash of the buffer (file path + timestamp + type + content), truncated to 16 chars. Used as part of the completion cache key so completions are invalidated when the user's edit context changes.

---

## Cache Layer

### `BoundedCache<V>` — `src/cache/boundedCache.ts`

Generic, fixed-capacity cache combining **LRU** (last recently used) and **LFU** (least frequently used) eviction.

- Each entry stores: `value`, `expiresAt` (optional TTL), `groupKey`, `lastAccessed`, `accessCount`.
- **Eviction score:** `accessCount / ageInSeconds` — entries with low access count and old last-access time are evicted first.
- **Group invalidation:** entries can be grouped by key (e.g., document URI); `invalidateGroup()` removes all entries for that group at once.
- **`buildCacheKey(...parts)`** — type-prefixed, length-encoded key builder to avoid collisions.

### `CompletionCache` — `src/cache/completionCache.ts`

Wraps `BoundedCache<ReplacementEdit>` for completion results.

- **Cache key** = `(documentUri, contentHash, line, character, editHistoryHash)`.
- **Content hash** — MD5 of the document text, cached per document version to avoid re-hashing.
- Subscribes to `onConfigChange` to rebuild cache when `completionCacheMaxEntries` or `completionCacheTtlMs` change.
- Invalidates all entries for a document when it is closed.

---

## Shared Types — `src/utils/types.ts`

| Type | Purpose |
|---|---|
| `ChatMessage` | `{ role, content }` for LLM chat |
| `ChatStreamChunk` | OpenAI-compatible SSE chunk shape |
| `ReplacementEdit` | `{ insertText, startPosition }` — what to insert |
| `PendingCompletion` | `{ documentUri, edit }` — active ghost suggestion |
| `IntentType` | `'added' \| 'pasted' \| 'edited' \| 'accepted' \| 'rejected'` |
| `PendingIntent` | In-progress edit group being tracked |
| `IntentEntry` | Finalised edit record in the buffer |
| `EnclosingScopes` | `{ enclosingClass, enclosingFunction, symbolsByName }` — from LSP |

---

## Git / Build Setup

- **`out/`** is excluded from Git tracking via `.gitignore` (untracked with `git rm --cached out/`).
- **`tsconfig.json`** targets `ES2022`, outputs to `out/`, includes `lib: ["ES2022", "DOM"]`.
- **`watch` task** compiles TypeScript in watch mode (`npm run watch`).
