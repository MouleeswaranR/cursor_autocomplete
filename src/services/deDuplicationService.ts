import * as vscode from 'vscode';
import { normalizeText, stringSimilarity } from '../utils/languageUtils';


interface DeDuplicationOutput{
    proceed:boolean;
    completion:string;
    reasonText?:string
}

export class DeDuplicationService{

    check(document:vscode.TextDocument,position:vscode.Position,completion:string):DeDuplicationOutput{
        /**
         * Example:
         *
         *   Cursor is at end of line 5: "const x = "
         *   Model returns: "42;"
         *
         *   → trimLookBehindOverlap checks "42;" against lines above — no match → keep
         *   → buildLookAhead finds no code below → proceed: true, completion: "42;"
         *
         *   If model returns "" or "   " → proceed: true (empty, nothing to insert)
         *   If model repeats a line already above cursor → completion trimmed to ""
         *     → proceed: false, reason: "All completion lines above cursor"
         */
        //checking if completion text is present
        if(!completion.trim()){
            return {proceed:true,completion};
        }

        completion=this.trimLookBehindOverlap(document,position,completion);

        //if there is already completion text in prefix
        if(!completion.trim()){
            return {proceed:false,completion,reasonText:'All completion lines above cursor'};
        }


        //checking for suffix lines 
        const lookahead=this.buildLookAhead(document,position);

        if(!lookahead.trim()){
            return {proceed:true,completion};
        }

        //check if any structural overalp bwteen model output and text after cursor
        if(this.hasStructuralOverlap(completion,lookahead)){
            return {proceed:false,completion,reasonText:'Completion duplicates existing code below cursor'};
        }

        //check for trailing overlap between suffix and completion text from model
        if(this.hasTrailingOverlap(completion,document,position)){
            return {proceed:false,completion,reasonText:'Trailing completion lines duplicate code exist below cursor'};
        }

        return {proceed:true,completion};


    }

    //checking duplication from model output with lines before cursor
    private trimLookBehindOverlap(document:vscode.TextDocument,position:vscode.Position,completion:string):string{
        /**
         * Lookbehind overlap example:
         *
         *   Existing code (above cursor):
         *     3|   const a = 1;
         *     4|   const b = 2;   ← cursor is here at end
         *
         *   Model completion:
         *     "  const b = 2;\n  const c = 3;"
         *
         *   "const b = 2;" already exists above the cursor, so it is stripped.
         *   Only "  const c = 3;" is returned.
         */
        const allLines=completion.split('\n');

        //collecting non empty lines
        const nonEmpty:{norm:string,index:number}[]=[];

        for(let i=0;i<allLines.length;i++){
            //checking if it is non empty line
            if(allLines[i].trim()){
                nonEmpty.push({norm:normalizeText(allLines[i]),index:i});
            }
        }

        //if there is no non-empty lines
        if(nonEmpty.length===0)return completion;

        const lookBehind:string[]=[];

        //traversing from current cursor position to 200 lines behind(in backwards)
        for(let line=position.line;line>=0 && lookBehind.length<200;line--){
            //checking if it is cursor line, take content efore cursor, else take full line
            const text=line==position.line?document.lineAt(line).text.slice(0,position.character):document.lineAt(line).text;

            if(text.trim()){
                lookBehind.push(normalizeText(text));
            }
        }

        //reversing the lines to arrange in order
        lookBehind.reverse();

        //if there is no line before
        if(lookBehind.length===0)return completion;

        const prefix=document.lineAt(position.line).text.slice(0,position.character);

        const variants:string[][]=[nonEmpty.map(e=>e.norm)];

        //special case to check completion text first line and prefix before cursor is mergeing or not
        if(nonEmpty[0].index==0 && prefix.trim()){
            const merged=normalizeText(prefix+allLines[0]);
            if(merged!==nonEmpty[0].norm){
                variants.push([merged,...nonEmpty.slice(1).map(e=>e.norm)]);
            }
        }

        //checking withiin last 5 of prefix to find any overlap between completion text from model and prefix text
        const windowStart=Math.min(0,lookBehind.length-5);

        let bestMatch=0;

        //checking from backwards of ending section of prefix matching with completion text at any position
        for(let start=lookBehind.length-1;start>=windowStart;start--){
            const maxComapre=Math.min(nonEmpty.length,lookBehind.length-start);
            for(const variant of variants){
                let matched=0;
                while(matched<maxComapre && variant[matched]===lookBehind[start+matched]){
                    matched++;
                }
                if(matched>bestMatch){
                    bestMatch=matched;
                }
            }
        }

        if(bestMatch===0)return completion;

        return allLines.slice(nonEmpty[bestMatch-1].index+1).join('\n');

    }


    //lines after cursor
    private buildLookAhead(document:vscode.TextDocument,position:vscode.Position):string{
        /**
         * Example:
         *
         *   Cursor is in the middle of line 5 after "return":
         *     5|   return █ x + 1;
         *     6|   }
         *     7|
         *     8|   function bar() {
         *
         *   suffix  = " x + 1;"  (text to the right of cursor on line 5)
         *   lines   = [" x + 1;", "   }", "", "   function bar() {"]
         *   result  = " x + 1;\n   }\n\n   function bar() {"
         */

        //text after cursor in cursor's line
        const suffix=document.lineAt(position.line).text.slice(position.character);

        const lines:string[]=[];

        const endLine=Math.min(position.line+100,document.lineCount-1);

        //pushing lines after cursor
        for(let i=position.line;i<=endLine;i++){
            lines.push(document.lineAt(i).text);
        }

        //below lines after cursor
        const below=lines.join('\n');


        return suffix && below ?`${suffix}\n${below}`:(suffix || below);
    }

    private hasStructuralOverlap(completion:string,lookahead:string):boolean{
        /**
         * Structural overlap example:
         *
         *   Code after cursor (lookahead):
         *     "  console.log(x);\n  return x;\n}"
         *
         *   Model completion:
         *     "  console.log(x);\n  return x;\n}\n"
         *
         *   Both "console.log(x);" and "return x;" appear consecutively in the
         *   lookahead with ≥0.85 similarity → structural overlap detected → skip insertion.
         *
         *   Single-line completions (compLines.length < 2) are never flagged here —
         *   they are handled by hasTrailingOverlap instead.
         */
        //removing whitespaces and normalizing lines 
        const compLines=completion.split('\n').filter(l=>l.trim()).map(normalizeText);
        const aheadLines=lookahead.split('\n').filter(l=>l.trim()).map(normalizeText);

        if(compLines.length<2||aheadLines.length<2)return false;

        //checking for 2 matched lines from model output and text after cursor
        for(let i=0;i<aheadLines.length-2;i++){
            let matched=0;

            for(let j=0;j<compLines.length && (i+j)<aheadLines.length;j++){
                if(stringSimilarity(compLines[j],aheadLines[i+j])>=0.85){
                    matched++;
                }else if(matched>0){
                    break;
                }
            }
            if(matched>=2)return true;
        }
        return false;
    }

     private hasTrailingOverlap(
        completionText: string,
        document: vscode.TextDocument,
        position: vscode.Position,
    ): boolean {
        /**
         * Trailing overlap example:
         *
         *   Existing code:
         *     10|   return x;
         *     11| }
         *
         *   Model completion:
         *     \"  return x;\\n}\\n\"
         *
         * If we already kept \"  return x;\" from earlier checks, we now look at the **end**
         * of the completion (\"}\\n\") and compare it to the **start** of the code after the cursor (\"}\\n\").
         * If they match, we should **not** insert another \"}\", because it is already there.
         */
        const compLines = completionText.split('\n');
        const trailing: string[] = [];
        for (let i = compLines.length - 1; i >= 0 && trailing.length < 5; i--) {
            if (compLines[i].trim()) trailing.unshift(normalizeText(compLines[i]));
        }
        if (trailing.length === 0) return false;

        // Build the list of **leading** lines starting at the cursor:
        // - any text to the right of the cursor on the current line
        // - then the next non‑empty lines below (up to 100)
        const leading: string[] = [];
        const suffix = document.lineAt(position.line).text.slice(position.character);
        if (suffix.trim()) leading.push(normalizeText(suffix));
        const end = Math.min(document.lineCount - 1, position.line + 200);
        for (let i = position.line + 1; i <= end && leading.length < 100; i++) {
            if (document.lineAt(i).text.trim()) {
                leading.push(normalizeText(document.lineAt(i).text));
            }
        }
        if (leading.length === 0) return false;

        // Now check if the last 1 line of the completion matches the first 1 line of the lookahead,
        // or the last 2 lines match the first 2 lines, and so on.
        const maxN = Math.min(trailing.length, leading.length);

        for (let n = maxN; n >= 1; n--) {
            const tail = trailing.slice(-n);
            let match = true;
            for (let i = 0; i < n; i++) {
                if (tail[i] !== leading[i]) { match = false; break; }
            }
            if (match) return true;
        }
        return false;
    }
}