import * as vscode from 'vscode';
import { BoundedCache, buildCacheKey } from '../cache/boundedCache';
import { getConfig } from './configurationService';

interface DefinitionTarget{
    uri:vscode.Uri;
    range:vscode.Range
}

type RawTypeHierarchyItem=vscode.TypeHierarchyItem|vscode.TypeHierarchyItem[];

//returns a tree model for a document
export class LSPService implements vscode.Disposable{
    private readonly disposables:vscode.Disposable[]=[];
    private currentMaxEntries:number;
    private  cache:BoundedCache<unknown>;


    constructor(){
        const configService=getConfig();
        this.currentMaxEntries=configService.lspCacheMaxEntries;
        this.cache=new BoundedCache(this.currentMaxEntries);

        //using listener to check if config changes for lsp cache entries
        this.disposables.push(
            configService.onConfigChange((config)=>{
                if(config.lspCacheMaxEntries!==this.currentMaxEntries){
                    this.cache=new BoundedCache<unknown>(config.lspCacheMaxEntries);
                    this.currentMaxEntries=config.lspCacheMaxEntries;
                }
            })
        );

        this.registerListeners();
    }

    //listeners used to invalidate cache on document change and document close events
    private registerListeners():void{

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e)=>{
                this.cache.invalidateGroup(e.document.uri.toString());
            }),
            vscode.workspace.onDidCloseTextDocument((doc)=>{
                this.cache.invalidateGroup(doc.uri.toString());
            })
        );

    }

    //getting document symbols  
    async getDocumentSymbols(document:vscode.TextDocument):Promise<vscode.DocumentSymbol[]>{
        const documentUri=document.uri.toString();

        const cacheKey=buildCacheKey(
            documentUri,
            'documentSymbols'
        )

        //checking if symbols for a document is already cached
        const cached=this.cache.get(cacheKey) as vscode.DocumentSymbol[]|undefined;

        if(cached){
            return cached;
        }
        try {
            //getting symbols of a document
            const symbols:vscode.DocumentSymbol[]=await vscode.commands.executeCommand(
                'vscode.executeDocumentSymbolProvider',
                document.uri,
            );

            //putting t into a cache
            this.cache.set(cacheKey,symbols,{groupkey:documentUri});

            return symbols;
        } catch (error) {
            return [];
        }
    }

    //finding all hierrachical or parent symbols type for a symbol at cursor(class name,interfcae name,function name)
    async getSuperTypedNames(document:vscode.TextDocument,position:vscode.Position):Promise<string[]>{

        const documentUri=document.uri.toString();
        
        const cacheKey=buildCacheKey(
            documentUri,
            'superTypes',
            `${position.line}:${position.character}`
        );

        const cached=this.cache.get(cacheKey)as string[]|undefined;

        if(cached!==undefined)return cached;

       try {
         //getting hierarchy of symbols from symbol preset at cursor
        const prepared=await vscode.commands.executeCommand<RawTypeHierarchyItem>(
            'vscode.prepareTypedHierarchy',
            documentUri,
            position
        );

        if(!prepared)return [];

        const roots:DefinitionTarget[]=Array.isArray(prepared)?prepared:[prepared];

        //getting all symbols type
        const superTypeResults=await Promise.allSettled(
            roots.map((item)=>{
                return vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                    'vscode.provideSuperTypes',
                    item
                )
            })
        );

        const names:string[]=[];

        for(const result of superTypeResults){
            if(result.status!=='fulfilled'||!result.value){
                continue;
            }

            for(const item of result.value){
                names.push(item.name);
            }
        }

        //getting only unique symbols
        const unique=[...new Set(names)];

        //caching 
        this.cache.set(cacheKey,unique,{groupkey:documentUri});

        return unique;
       } catch (error) {
        return [];
       }
    }

    dispose() {
        this.disposables.forEach((d)=>d.dispose());
    }
}