"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InlineCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const apiClient_1 = require("../api/apiClient");
const intentTracker_1 = require("../services/intentTracker");
const completionCache_1 = require("../cache/completionCache");
class InlineCompletionProvider {
    outputChannel;
    apiClient;
    intentTracker;
    completionCache;
    pendingCompletion = null; //used to track last pending completion so that duplication can be avoided if they are same
    lastCompletionText = '';
    lastCompletionPosition = null;
    lastCompletionUri = null;
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        this.apiClient = new apiClient_1.ApiClient(outputChannel);
        this.intentTracker = new intentTracker_1.IntentTracker();
        this.completionCache = new completionCache_1.CompletionCache();
    }
    lastCallTime = 0;
    debounceMs = 300;
    async provideInlineCompletionItems(document, position, _context, token) {
        try {
            this.log(`provideInlineCompletionItems called at Line No:${position.line}:${position.character}`);
            // Fix 4: Timestamp-based debounce
            const now = Date.now();
            if (now - this.lastCallTime < this.debounceMs) {
                return null;
            }
            this.lastCallTime = now;
            if (token.isCancellationRequested) {
                return null;
            }
            //Stage 1
            //checking current completion request with previously completed one
            const pendingCompletionResult = this.handleExistingPendingCompletion(document, position);
            if (pendingCompletionResult !== undefined) {
                return pendingCompletionResult;
            }
            //Stage2 caching
            const editHistoryHash = this.intentTracker.computeHash();
            this.log(`Cache Hash: ${editHistoryHash}`);
            const cachedResult = this.tryCachedCompletion(document, position, editHistoryHash);
            if (cachedResult) {
                return cachedResult;
            }
            //Stage 3
            const continuePrediction = this.tryContinuePrediction(document, position);
            if (continuePrediction !== undefined) {
                return continuePrediction;
            }
            //getting prefix lines of characters from position (0,0) of the file to the positsion(where the cursor is held)
            const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            //to avoid extension triggering twice for first time
            if (token.isCancellationRequested) {
                this.log('Request cancelled');
                return null;
            }
            let completion = '';
            //sending user input to LLM API Client
            try {
                completion = await this.callCompletionApi([{ role: 'system', content: `
                    You are a code autocomplete engine.

                    Rules:
                    - Complete the current line of code
                    - Return meaningful continuation (not single characters)
                    - Do not return partial tokens
                    - Prefer full expressions like function calls
                    - No explanations
                    ` },
                    { role: 'user', content: prefix, },
                ], token);
                this.log(`Completion result: ${completion}`);
            }
            catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    // ignore expected cancellation
                    return null;
                }
                this.log(`[APIError] ${error}`);
                return null;
            }
            // Fix 1: Reject weak completions
            if (!completion || completion.trim().length < 1) {
                return null;
            }
            const edit = {
                insertText: completion,
                startPosition: position
            };
            //adding the completed result from LLM in cache
            this.completionCache.set(document, position, editHistoryHash, edit);
            return this.activateCompletion(edit, document);
        }
        catch (error) {
            this.log(`Unknown error: ${error}`);
            return null;
        }
    }
    //checking in cache before llm call
    tryCachedCompletion(document, position, editHistoryHash) {
        //check if there is cached edit
        const cachedEdit = this.completionCache.get(document, position, editHistoryHash);
        //if there is no cache,return undefined
        if (!cachedEdit)
            return undefined;
        this.log(`Cache Hit: ${cachedEdit.insertText}`);
        //if there is cache, activate completion with cache
        return this.activateCompletion(cachedEdit, document);
    }
    //updating pending request and lastc ompleted text
    activateCompletion(edit, document) {
        this.lastCompletionPosition = edit.startPosition;
        this.lastCompletionText = edit.insertText;
        this.lastCompletionUri = document.uri.toString();
        //storing the current inline edit suggestion
        this.pendingCompletion = {
            documentUri: document.uri.toString(),
            edit
        };
        return this.createInlineCompletionList(edit.insertText);
    }
    //function to check whether to continue prediction for user on each cursor move or is it the same predicted text again typed by user to avoid new predictions each time
    tryContinuePrediction(document, position) {
        if (!this.lastCompletionPosition || !this.lastCompletionText || this.lastCompletionUri != document.uri.toString()) {
            return undefined;
        }
        //getting difference between currnet poistion and last prediction position
        const charsSinceCompletion = position.character - this.lastCompletionPosition.character;
        //if current position line and lastCompleted prediction line are different or if user went backwards, no need for prediction
        if (position.line != this.lastCompletionPosition.line || charsSinceCompletion <= 0) {
            return undefined;
        }
        //getting newly typed text from last predicted text
        const typedText = document.getText(new vscode.Range(this.lastCompletionPosition, position));
        // Fix 3: Better divergence logic (more flexible)
        const typed = typedText.trim();
        const predicted = this.lastCompletionText;
        if (predicted.includes(typed)) {
            const index = predicted.indexOf(typed);
            const remaining = predicted.slice(index + typed.length);
            if (remaining) {
                this.log(`Continuing prediction : typed: "${typedText}", remaining: "${remaining}"`);
                const replaceRange = new vscode.Range(position, position);
                return this.createInlineCompletionList(remaining, replaceRange);
            }
            this.log('User completed entire prediction');
            this.lastCompletionText = '';
            this.lastCompletionPosition = null;
            return null;
        }
        if (typedText.trim().length === 0) {
            return undefined; // ignore empty typing
        }
        //if divergence from predicted text is found on user text
        this.log(`Divergence detected: expected: ${this.lastCompletionText}, but got ${typedText}`);
        this.lastCompletionText = '';
        this.lastCompletionPosition = null;
        return undefined; //if undefined, continue to prediction
    }
    //to hande pending completion(last completion) and comparing it with current completion
    handleExistingPendingCompletion(document, position) {
        //if there is no pending completion exist, when extension is activated first time
        if (!this.pendingCompletion) {
            return undefined;
        }
        const pendingPosition = this.pendingCompletion.edit.startPosition;
        const pendingDocUri = this.pendingCompletion.documentUri;
        //if current editing document is not equal to last sugggestion document, then no need for last request to be stored,clearing it
        if (document.uri.toString() !== pendingDocUri) {
            this.clearPendingCompletion();
            return undefined;
        }
        //if current editing line is not equal to last suggestion's editing line , then no need for that, clearing it
        if (position.line !== pendingPosition.line) {
            this.clearPendingCompletion();
            return undefined;
        }
        //if current editing line content is same for the last request content, using it instead of LLM Call for ghost suggestion
        if (position.character === pendingPosition.character) {
            return this.createInlineCompletionList(this.pendingCompletion.edit.insertText);
        }
        //edge cases;
        this.clearPendingCompletion();
        return undefined;
    }
    //used to clear the last pending completion
    clearPendingCompletion() {
        this.pendingCompletion = null;
    }
    //helper function to create inline completion list for ghost suggestion
    createInlineCompletionList(text, range) {
        const newItem = new vscode.InlineCompletionItem(text, range);
        return { 'items': [newItem] };
    }
    //calling LLM and returning streaming output
    async callCompletionApi(messages, token) {
        const generator = await this.apiClient.complete(messages);
        let result = '';
        //getting chunks from the LLM(API client)
        for await (const chunk of generator) {
            if (token.isCancellationRequested) {
                this.apiClient.cancel();
                break;
            }
            result += chunk;
        }
        return result.trim();
    }
    //logging channel for vscode terminal
    log(message) {
        this.outputChannel.appendLine(`[Provider] ${message}`);
    }
    dispose() {
        this.apiClient.dispose();
        this.intentTracker.dispose();
        this.completionCache.dispose();
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=inlineCompletionProvider.js.map