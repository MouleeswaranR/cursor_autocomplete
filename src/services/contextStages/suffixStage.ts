import * as vscode from 'vscode';


//using only closing brackets as suffix
export class SuffixStage{

    buildSuffixAfterReplacement(
        document:vscode.TextDocument,
        position:vscode.Position
    ):string{  
        //here position the position after replacemnt region, getting the text after the replacement region
        const output:string[]=[document.lineAt(position.line).text.slice(position.character)];

        const startLine=position.line+1;

        //checking for next 3 lines of current position for any closing brackets
        for(let i=startLine;i<Math.min(document.lineCount,position.line+3+1);i++){
            const textLine=document.lineAt(i).text;

            const trimmedText=textLine.trim();

            //if there is nothing in trimmedtext,move to next line
            if(trimmedText==''){
                continue;
               //checking if line consists of only closing brackets 
            }else if(trimmedText.replace(/[{}\[\]()=;,.>]/g, '').trim()===''){
                output.push(textLine);
            }else{
                break;
            }
        }
        return output.join('\n');
    }
}