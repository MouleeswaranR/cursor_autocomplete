import * as vscode from 'vscode';


export class DeletionDecoration implements vscode.Disposable{

    private readonly disposabes:vscode.Disposable[]=[];
    private readonly decorationType:vscode.TextEditorDecorationType;
    private activeEditor:vscode.TextEditor|null=null;


    constructor(){
        //setting decoration type for deletion
        this.decorationType=vscode.window.createTextEditorDecorationType({
            backgroundColor:'rgba(255,100,100,0.3)',
            textDecoration:'line-through',
            color:'rgba(150,150,150,0.9)'
        });


        //while changing file clear decoration
        this.disposabes.push(
            vscode.window.onDidChangeActiveTextEditor(()=>{
                this.clearDecorations();
            })
        );

        //while changing text selection
        this.disposabes.push(
            vscode.window.onDidChangeTextEditorSelection((e)=>{
                if(this.activeEditor && e.textEditor===this.activeEditor){
                    const selection=e.selections[0];
                    if(selection && !selection.isEmpty){
                        this.clearDecorations();
                    }
                }
            })
        );
    }


    //clearing decorations while moving to other files
    clearDecorations()
    {
        if(this.activeEditor){
            this.activeEditor.setDecorations(this.decorationType,[]);
        }

        this.activeEditor=null;
    }

    //showing deletion decoration 
    showDeletion(editor:vscode.TextEditor,range:vscode.Range):void{
        this.clearDecorations();//clearing previous decorationsin

        //if there is no range to shown to delete
        if(range.isEmpty)return;

        this.activeEditor=editor;

        //applying range
        this.activeEditor.setDecorations(this.decorationType,[range]);
    }


    dispose() {
        this.disposabes.forEach(d=>d.dispose());
        this.decorationType.dispose();
    }

}