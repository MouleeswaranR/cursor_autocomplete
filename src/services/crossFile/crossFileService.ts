import * as vscode from 'vscode';
import { LSPService } from '../lspService';
import { ASTService } from '../astService';
import { SymbolIndex } from './symbolIndex';
import { IndexedSymbol } from '../../utils/types';
import { ReferenceExtractor } from './referenceExtractor';
import { SignatureProvider } from './signatureProvider';


export class CrossFileService implements vscode.Disposable{

    private readonly lspService:LSPService;
    private readonly astService:ASTService;
    private readonly symbolIndex:SymbolIndex;
    private readonly referenceExtractor:ReferenceExtractor;
    private readonly signatureProvider:SignatureProvider;
    private readonly disposables:vscode.Disposable[]=[];

    constructor(lspService:LSPService,astService:ASTService){
        this.lspService=lspService;
        this.astService=astService;
        this.symbolIndex=new SymbolIndex(this.lspService);
        //registering listners for saving and opening a text document
        this.referenceExtractor=new ReferenceExtractor(this.astService);
        this.signatureProvider=new SignatureProvider(this.astService);
        this.registerListeners();

    }

    //getting symbols for current file
    async getRelevantSymbols(document:vscode.TextDocument,prefix:string):Promise<IndexedSymbol[]>{
        
        //nearby context retrieval
        const nearByContext=this.referenceExtractor.extract(prefix,document.languageId);

        if(nearByContext.referenceNames.size===0)return [];

        const allSymbols=this.symbolIndex.getAllSymbols();

        //getting symbols which are not from current document
        const candidateSymbols=allSymbols.filter(symbol=> symbol.uri!==document.uri.toString() && !nearByContext.declaredIdentifiers.has(symbol.name));

        //checking refernced symbols is present in candidate symbol
        const referencedCandidates=candidateSymbols.filter(symbol=>nearByContext.referenceNames.has(symbol.name)
                && symbol.kind!==vscode.SymbolKind.Method
                && symbol.kind!==vscode.SymbolKind.Constructor
            );

        if(referencedCandidates.length===0)return [];

        //signature of refernced symbols
        const result = this.signatureProvider.extract(referencedCandidates);
        return result;
    }

    //listeners for activating cross file service and indexing of files when opened or saved
    private registerListeners(){
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc)=>{
                this.symbolIndex.indexDocument(doc);//indexing documents with specific symbols
            }),
            vscode.workspace.onDidOpenTextDocument((doc)=>{
                this.symbolIndex.indexDocument(doc);
            })
        );
    }

    dispose() {
        this.disposables.forEach((d)=>d.dispose());
        this.signatureProvider.clear();
        this.symbolIndex.clear();
    }
}