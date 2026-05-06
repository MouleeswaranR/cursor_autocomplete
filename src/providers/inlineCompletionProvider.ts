import * as vscode from 'vscode';
import { ChatMessage, PendingCompletion, ReplacementEdit } from '../utils/types';
import { ApiClient } from '../api/apiClient';
import { IntentTracker } from '../services/intentTracker';
import { CompletionCache } from '../cache/completionCache';
import { ContextGatherer } from '../services/contextGatherer';
import { ASTService } from '../services/astService';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable{
    private readonly outputChannel: vscode.OutputChannel;
    private readonly apiClient:ApiClient;
    private readonly intentTracker:IntentTracker;
    private readonly completionCache:CompletionCache;
    private readonly contextGatherer:ContextGatherer;
    private pendingCompletion: PendingCompletion|null=null;//used to track last pending completion so that duplication can be avoided if they are same
    private lastCompletionText='';
    private lastCompletionPosition:vscode.Position|null=null;
    private lastCompletionUri:string|null=null;

    constructor(astService:ASTService,outputChannel: vscode.OutputChannel){
        this.outputChannel=outputChannel;
        this.apiClient=new ApiClient(outputChannel);    
        this.intentTracker=new IntentTracker();
        this.completionCache=new CompletionCache();
        this.contextGatherer=new ContextGatherer(astService,this.intentTracker,this.outputChannel);       
    }
    
    private currentRequestId = 0;
    private readonly debounceMs = 300;

    async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, _context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionList|null>{
        try {   
            this.log(`provideInlineCompletionItems called at Line No:${position.line}:${position.character}`);

            // Each call gets a unique id; only the latest call survives the debounce.
            const requestId = ++this.currentRequestId;

            // Debounce: wait, then check if a newer call has already arrived.
            await new Promise<void>(resolve => setTimeout(resolve, this.debounceMs));

            if (token.isCancellationRequested || requestId !== this.currentRequestId) {
                return null;
            }

            //Stage 1
            //checking current completion request with previously completed one
            const pendingCompletionResult= this.handleExistingPendingCompletion(document,position);
            if(pendingCompletionResult!==undefined){
                return pendingCompletionResult;
            }

            //Stage2 caching
            const editHistoryHash=this.intentTracker.computeHash();
            this.log(`Cache Hash: ${editHistoryHash}`);
            const cachedResult=this.tryCachedCompletion(document,position,editHistoryHash);

            if(cachedResult){
                return cachedResult;
            }

            //Stage 3
            const continuePrediction=this.tryContinuePrediction(document,position);
            if(continuePrediction!==undefined){
                return continuePrediction;
            }
            
            //getting prefix lines of characters from position (0,0) of the file to the positsion(where the cursor is held)

            // const prefix = document.getText(
            //  new vscode.Range(new vscode.Position(0,0), position)
            // );

            const prefix=await this.contextGatherer.gatherContext(document,position);
            
            this.log(`Prefix: ${prefix}`);

            // Abort if a newer request has already arrived while we were gathering context.
            if(token.isCancellationRequested || requestId !== this.currentRequestId){
                this.log('Request cancelled or superseded');
                return null;
            }

            let completion='';
            //sending user input to LLM API Client
            try {
                completion=await this.callCompletionApi(
                    [{role:'system',content:`
                    You are a code autocomplete engine.

                    Rules:
                    - Complete the current line of code
                    - Return meaningful continuation (not single characters)
                    - Do not return partial tokens
                    - Prefer full expressions like function calls
                    - No explanations
                    `},
                     {role:'user',content:prefix,},
                    ],
                    token
                )
                this.log(`Completion result: ${completion}`)
            } catch (error) {    
                 if (error instanceof Error && error.name === "AbortError") {
                // ignore expected cancellation
                return null;
                }            
                this.log(`[APIError] ${error}`);
                return null;
            }

            // Discard if a newer request arrived while the API was streaming.
            if (requestId !== this.currentRequestId) {
                return null;
            }

            // Fix 1: Reject weak completions
            if (!completion || completion.trim().length < 1) {
                return null;
            }

            // Strip the already-typed line prefix from the completion so the
            // InlineCompletionItem only contains text that goes AFTER the cursor.
            const linePrefix = document.getText(
                new vscode.Range(new vscode.Position(position.line, 0), position)
            );
            if (completion.startsWith(linePrefix)) {
                completion = completion.slice(linePrefix.length);
            }


            const edit:ReplacementEdit={
                insertText:completion,
                startPosition:position
            }
            //adding the completed result from LLM in cache
            this.completionCache.set(document,position,editHistoryHash,edit);

            return this.activateCompletion(edit,document);
        } catch (error) {
            this.log(`Unknown error: ${error}`)
            return null;
        }
    }

    //checking in cache before llm call
    private tryCachedCompletion(document:vscode.TextDocument,position:vscode.Position,editHistoryHash:string):vscode.InlineCompletionList|undefined{
        //check if there is cached edit
        const cachedEdit=this.completionCache.get(document,position,editHistoryHash);

        //if there is no cache,return undefined
        if(!cachedEdit)return undefined;

        this.log(`Cache Hit: ${cachedEdit.insertText}`);

        //if there is cache, activate completion with cache
        return this.activateCompletion(cachedEdit,document,)

    }
    
    //updating pending request and lastc ompleted text
    private activateCompletion(
        edit:ReplacementEdit,
        document:vscode.TextDocument
    ):vscode.InlineCompletionList{  
        this.lastCompletionPosition=edit.startPosition;
        this.lastCompletionText=edit.insertText;
        this.lastCompletionUri=document.uri.toString();

        //storing the current inline edit suggestion
         this.pendingCompletion={
                documentUri:document.uri.toString(),
                edit
            }
        return this.createInlineCompletionList(edit.insertText);
    }

    //function to check whether to continue prediction for user on each cursor move or is it the same predicted text again typed by user to avoid new predictions each time
    private tryContinuePrediction(document:vscode.TextDocument,position:vscode.Position):vscode.InlineCompletionList|null|undefined{
        if(!this.lastCompletionPosition||!this.lastCompletionText||this.lastCompletionUri!=document.uri.toString()){
            return undefined;
        }

        //getting difference between currnet poistion and last prediction position
        const charsSinceCompletion=position.character-this.lastCompletionPosition.character;

        //if current position line and lastCompleted prediction line are different or if user went backwards, no need for prediction
        if(position.line!=this.lastCompletionPosition.line||charsSinceCompletion<=0){
            return undefined;
        }

        //getting newly typed text from last predicted text
        const typedText=document.getText(new vscode.Range(this.lastCompletionPosition,position));

        const typed = typedText;
        const predicted = this.lastCompletionText;

        if (predicted.startsWith(typed)) {
            const remaining = predicted.slice(typed.length);
            if (remaining) {
                this.log(`Continuing prediction : typed: "${typedText}", remaining: "${remaining}"`)
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
        this.lastCompletionText='';
        this.lastCompletionPosition=null;
        return undefined;//if undefined, continue to prediction
    }

    //to hande pending completion(last completion) and comparing it with current completion
    private handleExistingPendingCompletion(document:vscode.TextDocument,position:vscode.Position):vscode.InlineCompletionList|null|undefined{
        //if there is no pending completion exist, when extension is activated first time
        if(!this.pendingCompletion){
            return undefined;
        }

        const pendingPosition=this.pendingCompletion.edit.startPosition;
        const pendingDocUri=this.pendingCompletion.documentUri;

        //if current editing document is not equal to last sugggestion document, then no need for last request to be stored,clearing it
        if(document.uri.toString()!==pendingDocUri){
            this.clearPendingCompletion();
            return undefined;
        }

        //if current editing line is not equal to last suggestion's editing line , then no need for that, clearing it
        if(position.line!==pendingPosition.line){
            this.clearPendingCompletion();
            return undefined;
        }

        //if current editing line content is same for the last request content, using it instead of LLM Call for ghost suggestion
        if(position.character===pendingPosition.character){
            return this.createInlineCompletionList(this.pendingCompletion.edit.insertText);
        }

        //edge cases;
        this.clearPendingCompletion();
        return undefined;
    }

    //used to clear the last pending completion
    private clearPendingCompletion():void{
        this.pendingCompletion=null;
    }

    //helper function to create inline completion list for ghost suggestion
    private createInlineCompletionList(text:string,range?:vscode.Range):vscode.InlineCompletionList{
         const newItem=new vscode.InlineCompletionItem(text,range);
            return {'items':[newItem]}
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
        }
        return result.trim();
    }

    //logging channel for vscode terminal
    private log(message:string):void{
        this.outputChannel.appendLine(`[Provider] ${message}`)
    }

    dispose() {
        this.apiClient.dispose();
        this.intentTracker.dispose();
        this.completionCache.dispose();
    }
}