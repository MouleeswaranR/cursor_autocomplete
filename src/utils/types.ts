import * as vscode from 'vscode';
export interface ChatStreamChunk{
    id:string;
    object:string;
    created:number;
    model:string;
    choices:Array<{
        index:number;
        delta:{
            role?:string;
            content?:string;
        };
        finish_reason: string|null;
    }>;
   

}

export interface ChatMessage{
    role:'system'|'user'|'assistant';
    content:string;
}

export interface ReplacementEdit{
    insertText:string;
    startPosition:vscode.Position
}

export interface PendingCompletion{
    documentUri:string;
    edit:ReplacementEdit
}

export type IntentType='added'|'pasted'|'edited'|'accepted'|'rejected';

export interface PendingIntent{
    type:IntentType;
    filePath:string;
    originalContent:Map<number,string>;
    currentContent:Map<number,string>;
    startTime:number;
    lastActivityTime:number;
    affectedLines:Set<number>;
}


export interface IntentEntry{
    id:string;
    filePath:string;
    type:IntentType;
    lineRange:{start:number,end:number};
    content:string;
    timeStamp:number;
    suggestedPreview?:string;
}

export interface EnclosingScopes{
    enclosingClass: vscode.DocumentSymbol|null;
    enclosingFunction: vscode.DocumentSymbol|null;
    symbolsByName:Map<string,vscode.DocumentSymbol[]>;
}