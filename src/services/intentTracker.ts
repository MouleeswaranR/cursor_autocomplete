import * as vscode from 'vscode';
import { IntentEntry, IntentType, PendingIntent } from '../utils/types';
import * as crypto from 'crypto';


export class IntentTracker implements vscode.Disposable{
    private disposables: vscode.Disposable[]=[];
    private lastDocumentVersion:Map<string,number>=new Map();// store last version of each document/file
    private buffer:IntentEntry[]=[];
    private pendingIntent:PendingIntent|null=null;
    private flushTimeout:NodeJS.Timeout|null=null;
    private idCounter:number=0;

    constructor(){
        this.registerListeners();
    }

    computeHash():string{
        const content=this.buffer.map(
            e=>`${e.filePath}:${e.timeStamp}:${e.type}:${e.content}`
        ).join("|");

        return crypto.createHash('md5').update(content).digest('hex').slice(0,16);
    }

    //register listeners to find the changes inside the files and files switching pattern
    private registerListeners():void{
        this.disposables.push(
            //listener for all documents for tracking change
            vscode.workspace.onDidChangeTextDocument((e)=>{
                this.handleDocumentChange(e);   
        })
        );

        this.disposables.push(
             //listener for atracking file switches
            vscode.window.onDidChangeActiveTextEditor((editor)=>{
                this.handleActiveEditorChange(editor);
            })
        );
    
    }

    //tracking document changes from user 
    private handleDocumentChange(event:vscode.TextDocumentChangeEvent):void{
        const document=event.document;

        //if the current event's document is not a file type, return
        if(document.uri.scheme!=='file'){
            return;
        }

        //getting current editor window
        const activeEditor=vscode.window.activeTextEditor;

        //if there is no active editor or currently active document in active editor is not equal to event's document, then return
        if(!activeEditor||activeEditor.document.uri.toString()!==document.uri.toString()){
            return;
        }

        const docKey=document.uri.toString();//using document uri as document key for storing their version
        const previousVersion=this.lastDocumentVersion.get(docKey);//getting last version number of current document
        const currentVersion=document.version;//getting current version number

        //updating the current version number as last version number for current file
        this.lastDocumentVersion.set(docKey,currentVersion);

        //if current version difference is greater than 1, than event's document version and current document version is very different, create completely new Intent, else if difference is 1, currentVersion is next to previousVersion  
        if(previousVersion!==undefined && Math.abs(currentVersion-previousVersion)>1){
            //idf pending event for current file is too old make it null
            if(this.pendingIntent && this.pendingIntent.filePath===document.uri.fsPath){
                this.pendingIntent=null;
                this.clearFlushTimeout();//clearning current flush timeout after changing pending intent
            }
            return;
        }

        //creating intent for current file's changes
        for(const change of event.contentChanges){
            this.processChange(document,change);
        }
    }

    private processChange(document:vscode.TextDocument,change:vscode.TextDocumentContentChangeEvent):void{
        const isPaste=change.text.length>50; //to check if the change is a paste event;
        const filePath=document.uri.fsPath;

        const now=Date.now();
        const line=change.range.start.line;//line no at where the content changed
        const currentLineContent=line<document.lineCount?document.lineAt(line).text:'';//getting current line content

        //checking whether the intent is for current file and it is made less than 1.5s
        const canContinuePending=this.pendingIntent && this.pendingIntent.filePath===filePath && (now-this.pendingIntent?.lastActivityTime > 1500);

        //if it not recently made change in less than 1.5s then, finalizing intent
        if(!canContinuePending)
        {
            this.finalizeIntent();
        }

        //initializaing pending intent for a change 
        if(!this.pendingIntent){
            this.pendingIntent={
                type: isPaste?'pasted':'added',
                filePath:filePath,
                originalContent:new Map(),
                currentContent:new Map(),
                affectedLines:new Set(),
                startTime:now,
                lastActivityTime:now,
            }
        }

        //getting original Line contents
        this.captureOriginalLineContent(change,line,currentLineContent);

        //getting current file line contents and affectedline and last activity time
        this.pendingIntent.currentContent.set(line,currentLineContent);
        this.pendingIntent.affectedLines.add(line);
        this.pendingIntent.lastActivityTime=now;
        if(isPaste){
            this.pendingIntent.type='pasted';
        }

        //classifying pending intent
        this.pendingIntent.type=this.classifyIntentType(this.pendingIntent);


        //flush scheduling for 1.5s
        this.scheduleFlush();

    }

    //capturing original line content
    private captureOriginalLineContent(
        change:vscode.TextDocumentContentChangeEvent,
        line:number,
        currentLineContent:string
    ):void{
        //if original content was already there,return it
        if(this.pendingIntent?.originalContent.has(line)){
            return;
        }

        let originalLineText=currentLineContent;

        //if change rangelength is 0, no changes were made in existing content and change text length greater than 0 means new text added
        if(change.rangeLength==0 && change.text.length>0){
            const startChar=change.range.start.character;//getting the start character where the change made(where the cursor is placed)
            originalLineText=currentLineContent.slice(0,startChar)+currentLineContent.slice(startChar,change.text.length);//getting everything in content other than start character
        }

        //setting original content with the line numder
        this.pendingIntent?.originalContent.set(line,originalLineText);
    }

    private classifyIntentType(pendingIntent:PendingIntent):IntentType{
        //if type is already pasted,retun pated
        if(pendingIntent.type==='pasted')return 'pasted';

        let hasEdit=false,hasAddition=false;

        //checking all affected lines to check whether they are edited or added
        for(const line of pendingIntent.affectedLines){
            const originalText=pendingIntent.originalContent.get(line)??'';//originalText
            const currentText=pendingIntent.currentContent.get(line)??'';//currentText

            //if originalText length is 0 which meand it is blank and currently it has text means, newly content added
            if(originalText.trim().length===0 && currentText.trim().length>0){
                hasAddition=true;
            }else if(originalText.trim()!=currentText.trim()){//if current content is not equal to original content, it is eited
                hasEdit=true;
            }

        }

        if(hasAddition)return 'added';
        if(hasEdit)return 'edited';

        return 'edited';
    }

    //flush scheduling
    private scheduleFlush():void{
        this.clearFlushTimeout();//clearning existing flush timeout

        //setting flush timeout
        this.flushTimeout=setTimeout(()=>{
            this.finalizeIntent();//finalizing intent after flush scheduling 
        },1500);

    }

    //clearing flush scheduled
    private clearFlushTimeout():void{
        //if flush timeout exists,clearning it and reinitializing to null;
        if(this.flushTimeout){
            clearTimeout(this.flushTimeout);
            this.flushTimeout=null;
        }
    }


    //finalazing the pending intent before sending it to intent buffer
    private finalizeIntent(): void{
        this.clearFlushTimeout();//clearning timeouts

        //if there is no pending intent left
        if(!this.pendingIntent)return;

        //getting pendingIntent and setting it to null after finalizing intent
        const pending=this.pendingIntent;
        this.pendingIntent=null;

        let hasChange=false;

        //checking for a change in original and current content, if there is a change , build an intent entry for buffer
        for(const line of pending.affectedLines){
            const originalText=pending.originalContent.get(line)??'';
            const currentText=pending.currentContent.get(line)??'';

            if(originalText!=currentText){
                hasChange=true;
                break; //one change is enough;
            }
        }

        //if no change was found between original and current text
        if(!hasChange)return ;

        //sorting to get start line and end line in 1-based indexing
        const lines=Array.from(pending.affectedLines).sort((a,b)=>a-b);
        const startLine=lines[0]+1;
        const endLine=lines[lines.length-1]+1;

        //getting current content of document and joining them
        let contentLines:string[]=[];

        for(const line of lines){
            const text=pending.currentContent.get(line);
            if(text!==undefined){
                contentLines.push(text);
            }
        }

        const content=contentLines.join('\n');

        //creating an intent entry
        const entry:IntentEntry={
            id:`intent_${++this.idCounter}`,
            type:pending.type,
            filePath:pending.filePath,
            lineRange:{start:startLine,end:endLine},
            content:content,
            timeStamp:pending.lastActivityTime,
        }

        //checking if current entry can be merged with existing entries in buffer which came from same file with less than 5 seconds time gap of entry
        const merged=this.mayBeMergeWithRecent(entry);

        //if there is possibilty of merged entry, replacing the entry with same entry id with new merged entry
        if(merged){
            const idx=this.buffer.findIndex((e)=>e.id===merged.id);
            if(idx!==-1){
                this.buffer[idx]=merged;
            }
        }else{
            this.buffer.push(entry);
            //if buffer size is greater than 49, pop out the first entried entries keeping the ast 49 entries 
            while(this.buffer.length>49){
                this.buffer.shift();
            }
        }
    }

    private mayBeMergeWithRecent(entry:IntentEntry):IntentEntry|null
    {
        const now=Date.now();

        //taking already exitsing intents i descneding order to find the recent ones
        for(let i=this.buffer.length-1;i>=0;i--){
            const existing=this.buffer[i];

            //if time differenc between current intnet and existing intent from buffer is greater than 5secs,we dont need to merge
            if(now-existing.timeStamp>5000){
                break;
            }

            //skipping current entry if they are not from same file
            if(existing.filePath!==entry.filePath){
                continue;
            }

            //checking overlap or adjacent if they are from same file
            const overlap=existing.lineRange.start<=entry.lineRange.end && entry.lineRange.start<=existing.lineRange.end;

            const adjacent=Math.abs(existing.lineRange.end-entry.lineRange.start)<=1 || Math.abs(entry.lineRange.end-existing.lineRange.start)<=1 ;

            //if either overlap or adjacent, converting them into a single intent
            if(overlap||adjacent){

                const mergeType:IntentType=(existing.type==='edited'||entry.type==='edited')?'edited':(existing.type==='pasted'||entry.type==='pasted')?'pasted':entry.type;
                const mergeRange={
                    start:Math.min(entry.lineRange.start,existing.lineRange.start),
                    end:Math.max(entry.lineRange.end,existing.lineRange.end)
                }

                return{
                    id:existing.id,
                    type:mergeType,
                    content:entry.content,
                    timeStamp:entry.timeStamp,
                    lineRange:mergeRange,
                    filePath:entry.filePath
                }
            }    
        }
        return null;
    }    
//tracking how user switches between files
    private handleActiveEditorChange(editor:vscode.TextEditor|undefined):void{

        if(!this.pendingIntent)return; //if there is no pending intent , no need to check for file change
        
        //if editor document filepath is diferent than pendingIntent file path, need to finaliza intent for pending one and push it to the buffer
        if(!editor||editor.document.uri.fsPath!==this.pendingIntent.filePath){
            this.finalizeIntent();
        }
    }

    private relativeFilePath(filePath:string):string{
        //getting all workspace folders
        const workspaceFolders=vscode.workspace.workspaceFolders;

        if(!workspaceFolders||workspaceFolders.length===0)return filePath.split('/').pop()||filePath;

        for(const folder of workspaceFolders){
            //checking all folders active with filepath to see it start with same string
            if(filePath.startsWith(folder.uri.fsPath)){
                return filePath.slice(folder.uri.fsPath.length+1);
            }
        }

        return filePath.split('/').pop()||filePath;
    }

    serialize():string{
        this.finalizeIntent();

        if(this.buffer.length==0)return '';

        //using last 40 entries for serializing
        const entries=this.buffer.slice(-40);   

        const lines:string[]=[];

        //arranging all entries in a format and return its as a string
        for(let i=0;i<entries.length;i++){
            const entry=entries[i];

            const relativePath=this.relativeFilePath(entry.filePath);//getting relative file path

            const lineRange=entry.lineRange.start===entry.lineRange.end ?`${entry.lineRange.start}`:`${entry.lineRange.start}-${entry.lineRange.end}`;

            lines.push(`${i+1}. [${entry.type}] ${relativePath}: ${lineRange} -> "${entry.content}"`);
        }

        return lines.join('/n');
    }

    //recording accepted suggestion
     recordAcceptedSuggestion(
        filePath: string,
        line: number,
        content: string
    ): void {
        this.finalizeIntent();

        const entry: IntentEntry = {
            id: `intent_${++this.idCounter}`,
            type: 'accepted',
            filePath,
            lineRange: { start: line, end: line },
            content,
            timeStamp: Date.now(),
        }

        this.buffer.push(entry);

        while (this.buffer.length > 35) {
            this.buffer.shift()
        }
    }

    //recording rejected suggestion
    recordRejectedSuggestion(
        filePath: string,
        line: number,
        content: string
    ): void {
        const entry: IntentEntry = {
            id: `intent_${++this.idCounter}`,
            type: 'rejected',
            filePath,
            lineRange: { start: line, end: line },
            content,
            timeStamp: Date.now(),
        }

        this.buffer.push(entry);

        while (this.buffer.length > 35) {
            this.buffer.shift()
        }
    }

    dispose() {
        this.finalizeIntent();
        this.disposables.forEach(d=> d.dispose());
        this.clearFlushTimeout();
    }
}