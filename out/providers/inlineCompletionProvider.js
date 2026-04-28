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
class InlineCompletionProvider {
    outputChannel;
    apiClient;
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        this.apiClient = new apiClient_1.ApiClient(outputChannel);
    }
    async provideInlineCompletionItems(document, position, _context, token) {
        try {
            //getting prefix lines of characters from position (0,0) of the file to the positsion(where the cursor is held)
            const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            this.log(`provideInlineCompletionItems called at Line No:${position.line}:${position.character}`);
            let completion = '';
            //sending user input to LLM API Client
            try {
                completion = await this.callCompletionApi([{ role: 'system', content: `
                    You are a code completion engine.
                    - Output ONLY the completion text
                    - DO NOT explain
                    - DO NOT think
                    - DO NOT add comments
                    - DO NOT add new lines unless needed
                    - Keep it short
                    ` },
                    { role: 'user', content: prefix, },
                ], token);
                this.log(`Completion reuslt: ${completion}`);
            }
            catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    // ignore expected cancellation
                    return null;
                }
                this.log(`[APIError] ${error}`);
                return null;
            }
            const newItem = new vscode.InlineCompletionItem(completion);
            return { items: [newItem] };
        }
        catch (error) {
            this.log(`Unknown error: ${error}`);
            return null;
        }
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
            if (chunk.trim().length > 0) {
                return chunk;
            }
        }
        return '';
    }
    //logging channel for vscode terminal
    log(message) {
        this.outputChannel.appendLine(`[Provider] ${message}`);
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=inlineCompletionProvider.js.map