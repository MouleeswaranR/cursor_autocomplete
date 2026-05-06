import * as vscode from 'vscode';
import { ASTService } from '../astService';
import { findStatementEnd } from '../astAnalysis';
import { ReplacementEdit, ReplacementRegion } from '../../utils/types';

export class ReplacementRegionStage{

    constructor(private readonly astService:ASTService){

    }

    //compute last line to check for what changes needed there
    compute(document:vscode.TextDocument,position:vscode.Position):ReplacementRegion{
        //current line according to cursor position
        const currentLine=document.lineAt(position.line).text;

        //text after the cursor in current line
        let textAfterCursor=currentLine.slice(position.character);
        let endLine=position.line;
        let endChar=currentLine.length;

        const shouldTryExtension=this.shouldExtendRegion(textAfterCursor);

        //check if extension for current line needed and text after cursor is less than 20
        if(shouldTryExtension && textAfterCursor.length<20){
            //finding statement ending
           const extension=this.extendToStatementEnd(document,position,200-textAfterCursor.length,3);


           //if needed to be extended, text after cursor until statement end with their position
           if(extension){
            textAfterCursor=extension.text;
            endChar=extension.endChar;
            endLine=extension.endLine;
           }
    
        }

        //returning current line's replacament region until its statement end and its position
        return {
            text:textAfterCursor,
            range:new vscode.Range(
                position,
                new vscode.Position(
                    endLine,
                    endChar
                )
            )
        };
    }

    //check if current line where cursor needs to be replaced
    private shouldExtendRegion(textAfterCursor:string):boolean {
        const trimmed=textAfterCursor.trim();
        
        if(trimmed.length===0)return false;

        //finding open brackets, braces count
        const opens=(trimmed.match(/[([{]/g) || []).length;
        //finding closes brackets, braces count
        const closes=(trimmed.match(/[)\]})]/g) || []).length;

        // if open braces count is greater than closed braces, need closed barces, need replacement
        if(opens>closes){
            return true;
        }

        const continuationEndings = [',', '+', '-', '*', '/', '&&', '||', '|', '&', '.', '->', '\\', '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>>=', '<<=', '**=', '//=', '...', '?', ':'];
        //checking if trimmed content ends with continuation operator
        for(const ending of continuationEndings){
            if(trimmed.endsWith(ending)){
                return true;
            }
        }

        //checking for terminators
        const stateTerminators=[')','{','}',':'];
        const endsWithTerminator=stateTerminators.some((terminator)=>trimmed.endsWith(terminator));
        //if there is the content never ends with any of the terminator,need replacement
        if(!endsWithTerminator ){
            return true;
        }

        return false;
    }


    //extending the current line
    private extendToStatementEnd(
        document:vscode.TextDocument,
        position: vscode.Position,
        maxChars:number,
        maxLines:number,
    ):{text:string;endLine:number;endChar:number}|null{
        const startLine=position.line;
        const endLine=Math.min(document.lineCount-1,startLine+maxLines);

        const lines:string[]=[];

        for(let i=startLine;i<=endLine;i++){
            lines.push(document.lineAt(i).text);

        }

        const regionText=lines.join('\n');

        return this.astService.withParsedTree(regionText,(tree)=>{
            const result=findStatementEnd(
                tree,
                {
                    row:0,
                    column: position.character,
                }
            );
            if(!result){
                return null;
            }

            const absoluteEndLine=startLine+result.endLine;
            const absoluteEndChar=result.endChar;

            //text after cursor
            let text=document.lineAt(startLine).text.slice(position.character);
            //adding text after cursor next line
            for(let i=startLine+1;i<=absoluteEndLine;i++){
                text+=`\n${document.lineAt(i).text}`;
            }

            if(text.length>maxChars){
                return null
            }

            return {text,endLine:absoluteEndLine,endChar:absoluteEndChar};
        })
    }
}