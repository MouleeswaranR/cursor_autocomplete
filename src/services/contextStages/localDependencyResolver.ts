import * as vscode from 'vscode';
import { LSPService } from '../lspService';
import { EnclosingScopes } from '../../utils/types';


export class LocalDependyResolver{

    constructor(private readonly lspService:LSPService){
      

    }

    async collectSameFileDependencies(document:vscode.TextDocument,position:vscode.Position,scopes:EnclosingScopes,usedIdentifiers:Set<string>):Promise<string[]>{
           const output:string[]=[];
            const includedSymbols=new Set<string>;

            //pass 1-checking and getting the content of the current class where the cursor is inside
           if(scopes.enclosingClass){


            //class starting line no
            const classStartLine=scopes.enclosingClass.range.start.line;

            //exact class name starting position
            const classNamePosition=scopes.enclosingClass.selectionRange.start;

            //finding the symbols the class name is dependent on
            const baseNames=await this.lspService.getSuperTypedNames(document,classNamePosition);


            //getting content of all dependency symbol contents for  current  symbol
            for(const baseName of baseNames){//each baseName is a symbol

                if(includedSymbols.has(baseName)){
                    continue;
                }
                //finding the nearest symbol
                const baseSymbol=this.findNearestSymbolBeforeLine(scopes.symbolsByName,baseName,classStartLine);
                if(!baseSymbol)continue;

                output.push('');

                output.push(...this.getSymbolLines(document,baseSymbol));//add the complete lines of the base symbol which is the last occurence of it before the cursor
                includedSymbols.add(baseName);
            }
           }

           //pass 2-checking and getting the content of the current function where the cursor is inside
           if(scopes.enclosingFunction){

            //function starting line no
            const functionStartLine=scopes.enclosingFunction.range.start.line;

            //exact function name starting position
            const functionNamePosition=scopes.enclosingFunction.selectionRange.start;

            //finding the symbols the function name is dependent on
            const baseNames=await this.lspService.getSuperTypedNames(document,functionNamePosition);

            //getting content of all dependency symbol contents for current symbol
            for(const baseName of baseNames){//each baseName is a symbol

                if(includedSymbols.has(baseName)){
                    continue;
                }
                //finding the nearest symbol
                const baseSymbol=this.findNearestSymbolBeforeLine(scopes.symbolsByName,baseName,functionStartLine);
                if(!baseSymbol)continue;

                output.push('');

                output.push(...this.getSymbolLines(document,baseSymbol));//add the complete lines of the base symbol which is the last occurence of it before the cursor
                includedSymbols.add(baseName);
            }
           }

           //pass-3 : checking with all the used identifiers and getting ther lines

           for(const identifier of usedIdentifiers){
            //if identifier is already inside set, it means it is passed on pass1 or pass2 
            if(includedSymbols.has(identifier)){
                continue;
            }

            //finding the nearest symbol for identifier
            const symbol=this.findNearestSymbolBeforeLine(scopes.symbolsByName,identifier,position.line);

            if(!symbol)continue;

            output.push('');
            output.push(...this.getSymbolLines(document,symbol));
            includedSymbols.add(identifier);
           }

           return output;
          
    }


    private findNearestSymbolBeforeLine(
        symbolsByName:Map<string,vscode.DocumentSymbol[]>,
        name:string,
        lineExclusive:number
    ):vscode.DocumentSymbol|null{
        //finding all occurences of the symbols in the map stored
        const candidates=symbolsByName.get(name);

        if(!candidates||candidates.length===0)return null;

        let best:vscode.DocumentSymbol|null=null;

        //finding the occurence of the symbol nearest to the cursor line and need the neares occurence before cursor line(lineExclusive)
        for(const candidate of candidates){
            if(candidate.range.end.line>=lineExclusive||!this.isClassSymbol(candidate.kind)){
                continue;
            }

            if(!best||candidate.range.end.line>best.range.end.line){
                best=candidate;
            }
        }

        return best;
    }

    //concatenating the lines of a symbol wherever it is present between its range
    private getSymbolLines(document:vscode.TextDocument,symbol:vscode.DocumentSymbol):string[]{
            const lines:string[]=[];
    
            //concatenating all lines from start to end
            for(let i=symbol.range.start.line;i<=symbol.range.end.line;i++){
                const lineText=document.lineAt(i).text;
                lines.push(lineText);   
            }
            return lines;
        }

        //helper function to checek a symbol belongs to class
            private isClassSymbol(kind:vscode.SymbolKind):boolean{
                return [
                    vscode.SymbolKind.Class,
                    vscode.SymbolKind.Interface,
                    vscode.SymbolKind.Struct,
                    vscode.SymbolKind.Interface
                ].includes(kind);
            }
        
                //helper function to checek a symbol belongs to function
            private isFunctionSymbol(kind:vscode.SymbolKind):boolean{
                return [
                    vscode.SymbolKind.Function,
                    vscode.SymbolKind.Method,
                    vscode.SymbolKind.Constructor,
                ].includes(kind);
            }
}