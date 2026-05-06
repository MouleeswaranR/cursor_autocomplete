import * as vscode from 'vscode';
import { BoundedCache, buildCacheKey } from '../../cache/boundedCache';
import { ASTService } from '../astService';
import { IndexedSymbol } from '../../utils/types';
import { extractSignatureFromAST } from '../astAnalysis';


export class SignatureProvider{
    private readonly signatureCache:BoundedCache<string>;

    constructor(private readonly astService:ASTService){
        this.signatureCache=new BoundedCache<string>(1000);
    }

    async extract(symbols:IndexedSymbol[]):Promise<IndexedSymbol[]>{
        const result:IndexedSymbol[]=[];

        //going over all symbols and getting their signature
        for(const symbol of symbols){
            const signature=await this.extractSignature(symbol);
            if(!signature){
                continue;
            }
            result.push({...symbol,signature});
        }

        return result;
    }


    private async extractSignature(symbol:IndexedSymbol):Promise<string|undefined>{
        
        //cache key
        const cacheKey=buildCacheKey(
            'signatureProvider',
            symbol.uri,
            symbol.kind,
            symbol.name,
            symbol.range.startLine,
            symbol.range.startCharacter,
            symbol.range.endLine,
            symbol.range.endCharacter
        );

        //checking if already present on cache
        const cached=this.signatureCache.get(cacheKey);

        if(cached!==undefined){
            return cached;
        }

        //uri obejct of symbol's file
        const uri=vscode.Uri.parse(symbol.uri);

        const document=await vscode.workspace.openTextDocument(uri);

        //range of symbol to extract from its document text
        const range=new vscode.Range(
            symbol.range.startLine,
            symbol.range.startCharacter,
            symbol.range.endLine,
            symbol.range.endCharacter
        );

        //content of that symbol
        const fullText=document.getText(range);

        //signature of the symbol
        const signature=this.astService.withParsedTree(fullText,(tree)=>extractSignatureFromAST(tree,symbol.kind));

        if(signature){
            this.signatureCache.set(cacheKey,signature,{groupkey:symbol.uri});
            return signature;
        }else{
            return undefined;
        }

    }

    clear():void{
        this.signatureCache.clear();
    }
}