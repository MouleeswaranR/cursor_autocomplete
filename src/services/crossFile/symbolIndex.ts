import * as vscode from 'vscode';
import { LSPService } from '../lspService';
import { BoundedCache, buildCacheKey } from '../../cache/boundedCache';
import { IndexedSymbol } from '../../utils/types';


export class SymbolIndex{
    

    //cache for storing file with its symbols
    private readonly cache:BoundedCache<{version:number;symbols:IndexedSymbol[]}>
    private readonly trackedUris:Set<string>=new Set();

    constructor(private readonly lspService:LSPService){
        this.cache=new BoundedCache(1000);
    }


    //returning all symbols
    getAllSymbols():IndexedSymbol[]{
        const result:IndexedSymbol[]=[];

        for(const uri of Array.from(this.trackedUris)){
             const cacheKey=buildCacheKey('symbolIndex',uri);

            //getting entry of cached symbol for current uri
            const entry=this.cache.get(cacheKey);
            //if there is no entry,delete that uri from tracking
            if(!entry){
                this.trackedUris.delete(uri);
                continue;
            }

            //if there is entry with symbols
            if(entry.symbols.length>0){
                result.push(...entry.symbols);
            }
        }

        return result;
    }

    //indexing documents
    async indexDocument(document:vscode.TextDocument):Promise<void>{
        
        //if current documet is not a file 
        if(document.uri.scheme!=='file'){
            return;
        }

        //creating cache key
        const uri=document.uri.toString();
        const cacheKey=buildCacheKey('symbolIndex',uri);
        
        //getting cache if already there
        const cached=this.cache .get(cacheKey);

        //if already indexed current version of document
        if(cached && cached.version===document.version){
            return;
        }

        //extracting all symbols from documents
        const symbols=await this.lspService.getDocumentSymbols(document);

        //extracting specific symbols from all symbols
        const indexedSymbols=this.extractSymbols(symbols,uri);

        //setting cache
        this.cache.set(cacheKey,{version:document.version,symbols:indexedSymbols});
        this.trackedUris.add(uri);

    }

    //extracting symbols
    private extractSymbols(
        symbols: vscode.DocumentSymbol[],
        uri: string,
        containerName?: string
    ): IndexedSymbol[] {
        const result: IndexedSymbol[] = [];

        for (const symbol of symbols) {
            //if symbol is a relevant one
            if (this.isRelevantSymbolKind(symbol.kind)) {
                result.push({
                    name: symbol.name,
                    kind: symbol.kind,
                    containerName,
                    uri,
                    range: {
                        startLine: symbol.range.start.line,
                        startCharacter: symbol.range.start.character,
                        endLine: symbol.range.end.line,
                        endCharacter: symbol.range.end.character,
                    },
                });
            }

            if (symbol.children && symbol.children.length > 0) {
                const childContainer = containerName
                    ? `${containerName}.${symbol.name}`
                    : symbol.name;
                result.push(...this.extractSymbols(symbol.children, uri, childContainer));
            }
        }

        return result;
    }

    //symbol types
    private isRelevantSymbolKind(kind: vscode.SymbolKind): boolean {
        return [
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Interface,
            vscode.SymbolKind.Enum,
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Property,
            vscode.SymbolKind.Constant,
            vscode.SymbolKind.TypeParameter,
            vscode.SymbolKind.Struct,
        ].includes(kind);
    }

    clear():void{
        this.cache.clear();
        this.trackedUris.clear();
    }

}