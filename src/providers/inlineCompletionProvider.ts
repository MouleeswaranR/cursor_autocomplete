import * as vscode from 'vscode';
import { ChatMessage } from '../utils/types';
import { ApiClient } from '../api/apiClient';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider{
    private readonly outputChannel: vscode.OutputChannel;
    private readonly apiClient:ApiClient;

    constructor(outputChannel: vscode.OutputChannel){
        this.outputChannel=outputChannel;
        this.apiClient=new ApiClient(outputChannel);
    }
    
    async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, _context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionList|null>{
        try {   
            //getting prefix lines of characters from position (0,0) of the file to the positsion(where the cursor is held)
            const prefix=document.getText(
                new vscode.Range(new vscode.Position(0,0),position)
            )
            this.log(`provideInlineCompletionItems called at Line No:${position.line}:${position.character}`)
            let completion='';
            //sending user input to LLM API Client
            try {
                completion=await this.callCompletionApi(
                    [{role:'system',content:`
                    You are a code completion engine.
                    - Output ONLY the completion text
                    - DO NOT explain
                    - DO NOT think
                    - DO NOT add comments
                    - DO NOT add new lines unless needed
                    - Keep it short
                    `},
                     {role:'user',content:prefix,},
                    ],
                    token
                )
                this.log(`Completion reuslt: ${completion}`)
            } catch (error) {    
                 if (error instanceof Error && error.name === "AbortError") {
                // ignore expected cancellation
                return null;
                }            
                this.log(`[APIError] ${error}`);
                return null;
            }
            const newItem=new vscode.InlineCompletionItem(completion);
            return {items:[newItem]}
        } catch (error) {
            this.log(`Unknown error: ${error}`)
            return null;
        }
    }

    //calling LLM and returning streaming output
    private async callCompletionApi(messages:ChatMessage[],token:vscode.CancellationToken){
        const generator=await this.apiClient.complete(
            messages
        );

        let result='';

        //getting chunks from the LLM(API client)
        for await (const chunk of generator){
            if(token.isCancellationRequested){
                this.apiClient.cancel();
                break;
            }
            result+=chunk;
        if (chunk.trim().length > 0) {
            return chunk; 
        }
        }
        return '';
    }
    //logging channel for vscode terminal
    private log(message:string):void{
        this.outputChannel.appendLine(`[Provider] ${message}`)
    }
}