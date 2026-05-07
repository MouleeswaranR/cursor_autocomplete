import * as vscode from 'vscode';
import { ChatMessage, PendingCompletion, ReplacementEdit } from '../utils/types';
import { ApiClient } from '../api/apiClient';
import { IntentTracker } from '../services/intentTracker';
import { CompletionCache } from '../cache/completionCache';
import { ContextGatherer } from '../services/contextGatherer';
import { ASTService } from '../services/astService';
import { PromptBuilder } from '../services/promptBuilder';
import { DeDuplicationService } from '../services/deDuplicationService';
import { deprecate } from 'util';
import { DeletionDecoration } from '../ui/deletionDecoration';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable{
    private readonly outputChannel: vscode.OutputChannel;
    private readonly apiClient:ApiClient;
    private readonly intentTracker:IntentTracker;
    private readonly completionCache:CompletionCache;
    private readonly contextGatherer:ContextGatherer;
    private readonly promptBuilder:PromptBuilder;
    private readonly deDuplicationService:DeDuplicationService;
    private readonly deletionDecoration:DeletionDecoration;
    private pendingCompletion: PendingCompletion|null=null;//used to track last pending completion so that duplication can be avoided if they are same
    private lastCompletionText='';
    private lastCompletionPosition:vscode.Position|null=null;
    private lastCompletionUri:string|null=null;

    constructor(astService:ASTService,outputChannel: vscode.OutputChannel){
        this.outputChannel=outputChannel;
        this.apiClient=new ApiClient(outputChannel);    
        this.intentTracker=new IntentTracker();
        this.completionCache=new CompletionCache();     
        this.promptBuilder=new PromptBuilder();
        this.contextGatherer=new ContextGatherer(astService,this.intentTracker,this.outputChannel);   
        this.deDuplicationService=new DeDuplicationService();    
        this.deletionDecoration=new DeletionDecoration();
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

            //context gathered(prefix,replacement region,suffix,edit history etc)
            const completionContext=await this.contextGatherer.gatherContext(document,position);
            
            this.log(`CompletionContext: ${JSON.stringify(completionContext)}`);

            //system prompt with user prompt
            const messages=this.promptBuilder.buildPrompt(completionContext);

            // Abort if a newer request has already arrived while we were gathering context.
            if(token.isCancellationRequested || requestId !== this.currentRequestId){
                this.log('Request cancelled or superseded');
                return null;
            }

            let completion='';
            //sending user input to LLM API Client
            try {
                completion=await this.callCompletionApi(
                 messages,
                token,
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
                this.log('Rejected: completion empty after API call');
                return null;
            }

            // Strip the already-typed line prefix from the completion so the
            // InlineCompletionItem only contains text that goes AFTER the cursor.
            // Only strip when there is real (non-whitespace) content before the cursor —
            // otherwise we would remove leading indentation from Python completions.
            const linePrefix = document.getText(
                new vscode.Range(new vscode.Position(position.line, 0), position)
            );
            if (linePrefix.trim() && completion.startsWith(linePrefix)) {
                completion = completion.slice(linePrefix.length);
            }

            //cleaningoutput(backticks,empty text)
            completion=this.cleanCompletionText(completion);

            // Ensure continuation lines carry the current line's indentation.
            // The model only outputs text for the replace_region so lines 2+
            // won't have leading whitespace — they'd appear at column 0.
            completion=this.fixContinuationIndent(completion,document,position);

            //checking for deduplication
            const dedupResult=this.deDuplicationService.check(
                document,position,completion
            );

            if(!dedupResult.proceed){
                this.log(`DeDup rejected: ${dedupResult.reasonText??'no reason provided'}`);
                return null;
            }

            //removing duplications from output
            completion=dedupResult.completion;

            const edit=this.computeMinimalReplacement(document,completionContext.replacementRegion.range.start,completionContext.replacementRegion.range.end,completion);

            if(!edit|| edit.insertText.length===0){
                this.log(`No change detected — oldText matches newText or insertText empty. completion: ${JSON.stringify(completion)}`);
                return null;
            }

            this.log(`Replacement Edit ${JSON.stringify(edit)}`)

            //adding the completed result from LLM in cache
            this.completionCache.set(document,position,editHistoryHash,edit);

            return this.activateCompletion(edit,document);
        } catch (error) {
            this.log(`Unknown error: ${error}`)
            return null;
        }
    }

    //computing minimal differnece between original and model output
    private computeMinimalReplacement(
        document: vscode.TextDocument,
        regionStart: vscode.Position,
        regionEnd: vscode.Position,
        newText: string
    ): ReplacementEdit | null {
        // What’s in the document right now (from cursor to the end of the region we’re replacing).
        const oldText = document.getText(new vscode.Range(regionStart, regionEnd));
        if (oldText === newText) {
            return null;
        }

        //  only look at as many characters as the shorter string has, so we don’t go past the end.
        const minLength = Math.min(oldText.length, newText.length);

        // How many characters are the same at the beginning? Walk forward until they differ.
        let prefixLength = 0;
        while (prefixLength < minLength && oldText[prefixLength] === newText[prefixLength]) {
            prefixLength++;
        }

        // How many characters are the same at the end? Walk backward from the end (after the prefix).
        let suffixLength = 0;
        //to prevent from suffix check overalp with prefix
        const maxSuffixLength = minLength - prefixLength;
        while (
            suffixLength < maxSuffixLength &&
            oldText[oldText.length - 1 - suffixLength] === newText[newText.length - 1 - suffixLength]
        ) {
            suffixLength++;
        }

        // Where does the “different part” end in oldText and in newText? (Everything between prefix and suffix.)
        const oldDiffEnd = oldText.length - suffixLength;
        const newDiffEnd = newText.length - suffixLength;
        // The bit we’re actually removing — this is what we show in red when you accept.
        const deletedText = oldText.slice(prefixLength, oldDiffEnd);

        // Turn character counts into line/column positions so we can tell the editor where to delete.
        const regionStartOffset = document.offsetAt(regionStart);
        const actualDeleteStart = document.positionAt(regionStartOffset + prefixLength);
        const actualDeleteEnd = document.positionAt(regionStartOffset + oldDiffEnd);

        return {
            // “Replace from cursor to here.” Editor needs the range to start at the cursor.
            deleteRange: new vscode.Range(regionStart, actualDeleteEnd),
            // “Insert this.” It’s the new text from the start up to the end of the changed part.
            insertText: newText.slice(0, newDiffEnd),
            deletedText,
            // “Only highlight this part in red” — just the middle we’re deleting, not the whole range.
            _actualDeleteRange: deletedText ? new vscode.Range(actualDeleteStart, actualDeleteEnd) : undefined,
        };
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
        this.lastCompletionPosition=edit.deleteRange.start;
        this.lastCompletionText=edit.insertText;
        this.lastCompletionUri=document.uri.toString();

        //storing the current inline edit suggestion
         this.pendingCompletion={
                documentUri:document.uri.toString(),
                edit
            }

        //showing deletion decoration on ui
        if(edit.deletedText.length>0){
            const editor=vscode.window.activeTextEditor;
            //checking if editor document and current document are same
            if(editor && editor.document.uri.toString()===document.uri.toString()){
                const decorationRange=edit._actualDeleteRange??edit.deleteRange;
                this.deletionDecoration.showDeletion(editor,decorationRange);
            }
        }
        return this.createInlineCompletionList(edit.insertText,edit.deleteRange);
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

        const pendingPosition=this.pendingCompletion.edit.deleteRange.start;
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
    clearPendingCompletion(): void {
        this.pendingCompletion = null;
        this.deletionDecoration.clearDecorations();
    }

    //helper function to create inline completion list for ghost suggestion
    private createInlineCompletionList(text:string,range?:vscode.Range):vscode.InlineCompletionList{
         const newItem=new vscode.InlineCompletionItem(text,range);

        return {'items':[newItem]}
    }

    getPendingEdit():ReplacementEdit|null{
        return this.pendingCompletion?.edit??null;
    }

      getIntentTracker(): IntentTracker {
        return this.intentTracker;
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

    //removing backticks or empty output from llm
    // Lines 2+ in a multi-line completion need to carry the current line's indentation.
    // The model outputs only the replace_region text and has no way to know the
    // surrounding indentation level, so continuation lines often come back unindented.
    private fixContinuationIndent(completion: string, document: vscode.TextDocument, position: vscode.Position): string {
        const lines = completion.split('\n');
        if (lines.length <= 1) return completion;

        // Leading whitespace of the cursor's line = the indentation level we're at
        const indent = document.lineAt(position.line).text.match(/^(\s*)/)?.[1] ?? '';
        if (!indent) return completion;

        const [first, ...rest] = lines;
        const fixed = rest.map(line => {
            if (!line.trim()) return line;                  // preserve blank lines as-is
            if (line.startsWith(indent)) return line;       // model already included correct indent
            return indent + line;                           // prepend missing indentation
        });
        return [first, ...fixed].join('\n');
    }

     private cleanCompletionText(text: string): string {
        let cleaned = text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        const explanationPattern = /\n\n(?:\/\/|\/\*|#|Note:|Explanation:)[\s\S]*$/;
        cleaned = cleaned.replace(explanationPattern, '');
        return cleaned.trimEnd();//trimming at end because python syntax for indentation will be error if removed at start
    }

    //logging channel for vscode terminal
    private log(message:string):void{
        this.outputChannel.appendLine(`[Provider] ${message}`)
    }

    dispose():void {
        this.apiClient.dispose();
        this.intentTracker.dispose();
        this.completionCache.dispose();
        this.deletionDecoration.dispose();
        this.contextGatherer.dispose();
    }
}