
import * as vscode from 'vscode';
import { LSPService } from '../lspService';
import { EnclosingScopes } from '../../utils/types';
import { extractIdentifiers, getTruncationMarker } from '../../utils/languageUtils';
import { findImportLineSpans, parseImportBindings } from '../../utils/importAnalysis';
import { LocalDependyResolver } from './localDependencyResolver';


export class PrefixStage{

    private readonly localDependencyResolver:LocalDependyResolver;

    constructor(private readonly lspService:LSPService,private readonly outputChannel:vscode.OutputChannel){
        this.localDependencyResolver=new LocalDependyResolver(this.lspService);
    }

    async buildPrefix(document:vscode.TextDocument,position:vscode.Position):Promise<string>{

        //if cursor position is less than 150, get full file
        if (position.line < 150) {
            return this.getVerbatimPrefix(document, position);
        }

        const scopes = await this.getEnclosingScopes(document, position);

        //if there is no function where cursor is placed
        if (!scopes.enclosingFunction) {
            return this.buildSimplifiedPrefix(document, position, 150);
        }


        const functionStartLine = scopes.enclosingFunction.range.start.line;
        const linesFromFunctionStart = position.line - functionStartLine >= 150;

        return this.buildScopedPrefix(document, position, scopes, linesFromFunctionStart);
    }

    //build prefix according to if function is larger or smaller one
    private async buildScopedPrefix(document:vscode.TextDocument,position:vscode.Position,scopes:EnclosingScopes,isLargeFunction:boolean):Promise<string>{
        const cursorLine=position.line;
        const functionStartLine=scopes.enclosingFunction?.range.start.line??cursorLine;
        const classHeaderLines=this.collectClassHeaderLines(document,scopes,functionStartLine);

        this.log(classHeaderLines.join("\n"));
        
        //if it is not a large function ,then its a small function, take full function
        if(!isLargeFunction){
            //getting function lines from start of it to current position
            const functionLines=this.collectLinesToCursor(document,functionStartLine,position);

            //identfiers used in class Headers and inside the function
            const usedIdentifiers=extractIdentifiers(
                [...classHeaderLines,...functionLines].join('\n'),
                document.languageId
            );

            //imports of the identifiers used 
            const usedImports=this.getUsedImports(document,usedIdentifiers);

            //file dependencies
            const sameFileDeps=await this.localDependencyResolver.collectSameFileDependencies(document,position,scopes,usedIdentifiers);

            return this.assemblePrefixParts(
                usedImports,
                sameFileDeps,
                classHeaderLines,
                functionLines
            ).join('\n');
        }

        //if the function is a large function
        const functionSetupEnd=Math.min(functionStartLine+30,cursorLine);//getting line no from  30 lines of function
        const recentContextStart=Math.max(functionSetupEnd+1,cursorLine-100);//getting line no from 100 lines of function before cursor

        //getting the first 30 lines content from function start
        const functionSetupLines=this.collectLinesToCursor(
            document,
            functionStartLine,
            new vscode.Position(
                functionSetupEnd+1,
                0
            ),
        );

        //getting the  last 100 lines content before cursor
        const recentContextLines=this.collectLinesToCursor(
            document,
            recentContextStart,
            new vscode.Position(
                position.line+1,
                0
            ),
        );

         //identfiers used in class Headers and inside the function(large function)
        const usedIdentifiers=extractIdentifiers(
            [...classHeaderLines,...functionSetupLines,...recentContextLines].join('\n'),
            document.languageId
        );

        //imports of the identifiers used 
        const usedImports=this.getUsedImports(document,usedIdentifiers);

        //file dependencies
        const sameFileDeps=await this.localDependencyResolver.collectSameFileDependencies(document,position,scopes,usedIdentifiers);

        //still recent context lines are not added
        const output= this.assemblePrefixParts(
            usedImports,
            sameFileDeps,
            classHeaderLines,
            functionSetupLines
        );

        //check if recent context lines is present
        if(recentContextLines.length>0){
            //checking if function end line is not overlapping with recent context start
            const skippedLines=recentContextStart-functionSetupEnd;

            if(skippedLines>0){
                this.log(`Truncating ${skippedLines} lines in large function`);
                output.push(getTruncationMarker(document.languageId,skippedLines));
            }
            output.push(...recentContextLines);
        }

        return output.join("\n");
    }

    //collecting clas
    private collectClassHeaderLines(
        document:vscode.TextDocument,
        scopes:EnclosingScopes,
        functionStartLine:number
    ):string[]{

        const classStartLine=scopes.enclosingClass?.range.start.line//class start line

        if(classStartLine===undefined||classStartLine>=functionStartLine){
            return [];
        }

        //finding the line where the class header ends
        const classHeaderEnd=this.findClassHeaderEnd(document,classStartLine);

        return this.collectLinesToCursor(document,classStartLine,new vscode.Position(classHeaderEnd+1,0));
    }


    private buildSimplifiedPrefix(document:vscode.TextDocument,position:vscode.Position,lineLimit:number):string{

        const cursorLine=position.line;
        const startLine=Math.max(0,cursorLine-lineLimit);

        //getting last 150 lines from cursor
        const recentLines=this.collectLinesToCursor(document,startLine,position);

        //getting identifiers from the current document
        const usedIdentifiers=extractIdentifiers(recentLines.join("\n"),document.languageId);

        //getting used imports 
        const usedImports=this.getUsedImports(document,usedIdentifiers);

        return this.assemblePrefixParts(usedImports,[],[],recentLines).join("\n");

    }


    //finding class header line number
    private findClassHeaderEnd(document:vscode.TextDocument,classStartLine:number):number{

        //if python , class name declared lie will contain ':', take classStartLine to that lien contain ':'
        if(document.languageId==='python'){
            for(let i=classStartLine;i<document.lineCount;i++){
                if(document.lineAt(i).text.includes(':')){
                    return i;
                }
            }
            return classStartLine;
        }

        //for other languages, it starts with '{'
        for(let i=classStartLine;i<Math.min(classStartLine+10,document.lineCount);i++){
                if(document.lineAt(i).text.includes('{')){
                    return i;
                }
            } 
        
            return classStartLine;
    }
    private getUsedImports(document:vscode.TextDocument,usedIdentifiers:Set<string>):string[]{

        const languageId=document.languageId;

        //finding import line spans
        const importSpans=findImportLineSpans(document.getText(),document.languageId);

        if(importSpans.length===0)return [];

        const usedImports:string[]=[];

        for(const span of importSpans){
            const importLines:string[]=[];

            //getting the import lines from span start t end
            for(let i=span.start;i<=span.end && i<document.lineCount;i++){
                importLines.push(document.lineAt(i).text)
            }

            //join all import lines
            const importText=importLines.join("\n");

            //check for package imports
            if(this.isAlwaysIncludedImportSpan(importLines,languageId)){
                usedImports.push(...importLines);
                continue;
            }

            if(usedIdentifiers.size==0)continue;

            //get imports original name, alias names and local names for them
            const bindings=parseImportBindings(importText,languageId);
            const providedNmaes=Array.from(bindings.importedLocalNames);
            const isUsed=providedNmaes.some((name)=>usedIdentifiers.has(name));

            if(isUsed){
                usedImports.push(...importLines);
            }
        }
        return usedImports;
    }

    //concatenating all parts needed for prefix
    private assemblePrefixParts(
        usedImports:string[],
        sameFileDeps:string[],
        classHeaderLines:string[],
        primaryLines:string[],
    ):string[]{
        const output:string[]=[];

        if(usedImports.length>0){
            output.push(...usedImports);
        }

        if(sameFileDeps.length>0){
            output.push(...sameFileDeps);
        }

        if(classHeaderLines.length>0){
            output.push(...classHeaderLines);
        }

        if(primaryLines.length>0){
            output.push(...primaryLines);
        }

        return output;
    }
    //check if language declartaions are at top(only for java and go)
    private isAlwaysIncludedImportSpan(lines:string[],languageId:string):boolean{
        if(languageId!=='go' && languageId!=='java'){
            return false;
        }

        const firstNonEmpty=lines.find((line)=> line.trim()!=='')?.trim();
        return firstNonEmpty?.startsWith('package ')??false;
    }

    //find the current symbol in which the cursor resides in present
    private async  getEnclosingScopes(document:vscode.TextDocument,position:vscode.Position):Promise<EnclosingScopes>{
        //returns a tree model of file's symbols in hierarchy
        const symbols=await this.lspService.getDocumentSymbols(document);//getting document symbols using command or from cache;

        const symbolsByName=new Map<string,vscode.DocumentSymbol[]>();

        let enclosingFunction:vscode.DocumentSymbol|null=null;
        let enclosingClass:vscode.DocumentSymbol|null=null;
        let functionDepth=-1;
        let classDepth=-1;

        const findEnclosing=(syms:vscode.DocumentSymbol[],depth:number)=>{

            for(const symbol of syms){
                //if symbols already exits in map, push current entry of symbol to it
                const existing=symbolsByName.get(symbol.name);
                if(existing){
                    existing.push(symbol);
                    return;
                }
                
                //pushing a new symbol to map
                symbolsByName.set(symbol.name,[symbol]);

                //if symbol rage comes between current cursor position, checkif it a fucntion or class and use depth to find the symbol's last in-depth occurence for creating a good context
                if(symbol.range.contains(position)){
                    if(this.isFunctionSymbol(symbol.kind) && depth>=functionDepth){
                        enclosingFunction=symbol;
                        functionDepth=depth;
                    }

                    if(this.isClassSymbol(symbol.kind) && depth>=classDepth){
                        enclosingClass=symbol;
                        classDepth=depth;
                    }
                }

                //calling children symbols of current symbol
                if(symbol.children && symbol.children.length>0){
                    findEnclosing(symbol.children,depth+1);
                }
            }
        }

        findEnclosing(symbols,0);

        return {enclosingClass,enclosingFunction,symbolsByName};

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
    
    //get full file lines
    getVerbatimPrefix(document:vscode.TextDocument,position:vscode.Position):string{
        return this.collectLinesToCursor(document,0,position).join("\n");
    }


    //collecting prefix lines
    private collectLinesToCursor(document:vscode.TextDocument,startLine:number,position:vscode.Position):string[]{

        //checking if startline greater than end line(position)
        if(startLine>position.line){
            return [];
        }

        const lines:string[]=[];

        //concatenating all lines from start to end
        for(let i=startLine;i<=position.line;i++){
            const lineText=document.lineAt(i).text;

            //in the end line need only cotent before currsor
            lines.push(i===position.line?lineText.slice(0,position.character):lineText);
        }
        return lines;
    }

     //logging channel for vscode terminal
    private log(message:string):void{
        this.outputChannel.appendLine(`[Prefix Stage] ${message}`)
    }
}