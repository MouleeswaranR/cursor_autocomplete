import * as vscode from 'vscode';
import { IntentTracker } from './intentTracker';
import { PrefixStage } from './contextStages/prefixStage';
import { LSPService } from './lspService';
import { ReplacementRegionStage } from './contextStages/replacementRegionStages';
import { ASTService } from './astService';
import { SuffixStage } from './contextStages/suffixStage';
import { CrossFileService } from './crossFile/crossFileService';
import { CompletionContext } from '../utils/types';

export class ContextGatherer implements vscode.Disposable{
    private readonly intentTracker:IntentTracker;
    private readonly prefixStage:PrefixStage;
    private readonly lspService:LSPService;//as lsp service is required for all context gathering stages, use a single unifid instance
    private readonly replacementRegion:ReplacementRegionStage;
    private readonly suffixStage:SuffixStage;
    private readonly crossFileService:CrossFileService;

    constructor(astService:ASTService,intentTracker:IntentTracker,private readonly outputChannel:vscode.OutputChannel){
        this.intentTracker=intentTracker;
        this.lspService=new LSPService();
        this.prefixStage=new PrefixStage(this.lspService,this.outputChannel);
        this.replacementRegion=new ReplacementRegionStage(astService);
        this.suffixStage=new SuffixStage();
        this.crossFileService=new CrossFileService(this.lspService,astService);
    }

    async gatherContext(
        document:vscode.TextDocument,
        position:vscode.Position
    ):Promise<CompletionContext>{


        //getting all edit history as a string formatted
        const editHistory=this.intentTracker.serialize(); 

        //stage1: prefix building 
        const prefix= await this.prefixStage.buildPrefix(document,position)??''; 

        //stage 2: replacememt region
        const replacementRegion=this.replacementRegion.compute(
            document,position
        );

        //stage 3: suffix region after eplacemnet region
        const suffix=this.suffixStage.buildSuffixAfterReplacement(
            document,
            replacementRegion.range.end,
        );
        
        //getting cross file symbols
        const crossFileSymbols=await this.crossFileService.getRelevantSymbols(document,prefix);
       
        return {
            prefix,
            replacementRegion,
            suffix,
            cursorPosition:position,
            languageId:document.languageId,
            filePath:vscode.workspace.asRelativePath(document.uri),
            editHistoryHash:editHistory,
            crossFileSymbols:crossFileSymbols
        }
    }

    dispose():void {
        // No operation for disposing here
    }
}