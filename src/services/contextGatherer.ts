import * as vscode from 'vscode';
import { IntentTracker } from './intentTracker';
import { PrefixStage } from './contextStages/prefixStage';
import { LSPService } from './lspService';


export class ContextGatherer implements vscode.Disposable{
    private readonly intentTracker:IntentTracker;
    private readonly prefixStage:PrefixStage;
    private readonly lspService:LSPService;//as lsp service is required for all context gathering stages, use a single unifid instance

    constructor(intentTracker:IntentTracker,private readonly outputChannel:vscode.OutputChannel){
        this.intentTracker=intentTracker;
        this.lspService=new LSPService();
        this.prefixStage=new PrefixStage(this.lspService,this.outputChannel);
    }

    async gatherContext(
        document:vscode.TextDocument,
        position:vscode.Position
    ):Promise<string>{

        //getting all edit history as a string formatted
        const editHistory=this.intentTracker.serialize(); 
        return await this.prefixStage.buildPrefix(document,position)??'';  
    }

    dispose():void {
        // No operation for disposing here
    }
}