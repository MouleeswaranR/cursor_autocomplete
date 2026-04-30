import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BoundedCache, buildCacheKey } from './boundedCache';
import { ReplacementEdit } from '../utils/types';
import { getConfig } from '../services/configurationService';

export class CompletionCache implements vscode.Disposable{
    private cache:BoundedCache<ReplacementEdit>;
    private readonly disposables:vscode.Disposable[]=[];
    private ttlMs:number;
    private currentMaxEntries:number
    private contentHashByDocument:Map<string,{version:number,hash:string}>=new Map();//to avoid same document to be hashed again and again 

    constructor(){
        const configService=getConfig();

        //getting max entries and TTL values from configuration
        this.currentMaxEntries=configService.completionCacheMaxEntries;
        this.ttlMs=configService.completionCacheTtlMs;

        //creating bouded cache
        this.cache=new BoundedCache<ReplacementEdit>(this.currentMaxEntries);

        this.disposables.push(
            //creating a callback to check if value for max entries change, if changed creating a new cache entry
            configService.onConfigChange((config)=>{
                if(config.completionCacheMaxEntries!==this.currentMaxEntries){
                    this.currentMaxEntries=config.completionCacheMaxEntries;
                    this.cache=new BoundedCache<ReplacementEdit>(this.currentMaxEntries);
                }

                if(config.completionCacheMaxEntries!==this.currentMaxEntries){
                    this.ttlMs=config.completionCacheTtlMs;
                }
            })
        );

        //if current file is closed, deleting the cache prints of those files
         this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(document=>{
                const documentUri=document.uri.toString();
                this.cache.invalidateGroup(documentUri);
                this.contentHashByDocument.delete(documentUri);
            })
         ) 
    }

    //hashing document content
    private computContentHash(content:string):string{
        return crypto.createHash('md5').update(content).digest('hex').slice(0,16);
    }

    //creating hash without duplicates
    private getContentHash(document:vscode.TextDocument):string{
        const uri=document.uri.toString();
        const cached=this.contentHashByDocument.get(uri);

        //checking if document is laready cached and same version for document
        if(cached && cached.version===document.version){
            return cached.hash;
        }

        //hashing the full content of document
        const hash=this.computContentHash(document.getText());
        this.contentHashByDocument.set(uri,{version:document.version,hash:hash});//adding it map to avoid duplicates
        return hash;
    }

    //setting cache inside map
    set(
        document:vscode.TextDocument,
        position:vscode.Position,
        editHistoryHash:string,
        completion:ReplacementEdit
    ):void{
        const documentUri=document.uri.toString();
        const contentHash=this.getContentHash(document);

        //building cache key
        const key=buildCacheKey(documentUri,contentHash,position.line,position.character,editHistoryHash);

        //adding cache entry
        this.cache.set(key,completion,{ttlMs:this.ttlMs,groupkey: documentUri});
    }


    //getting a cache for a document
    get(document:vscode.TextDocument,position:vscode.Position,editHistoryHash:string):ReplacementEdit|undefined{
        const documentUri=document.uri.toString();
        const contentHash=this.getContentHash(document);

        //building cache key
        const key=buildCacheKey(documentUri,contentHash,position.line,position.character,editHistoryHash);

        return this.cache.get(key);
    }

    dispose() {
        this.disposables.forEach(d=>d.dispose());
        this.cache.clear();
        this.contentHashByDocument.clear();
    }
}