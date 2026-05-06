import * as TreeSitter from 'web-tree-sitter';
import * as path from 'path';

const LANGUAGE_MAP: Record<string, string> = {
    typescript: 'tree-sitter-typescript.wasm',
    typescriptreact: 'tree-sitter-tsx.wasm',
    javascript: 'tree-sitter-javascript.wasm',
    javascriptreact: 'tree-sitter-javascript.wasm',
    python: 'tree-sitter-python.wasm',
    rust: 'tree-sitter-rust.wasm',
    go: 'tree-sitter-go.wasm',
    java: 'tree-sitter-java.wasm',
    c: 'tree-sitter-c.wasm',
    cpp: 'tree-sitter-cpp.wasm',
};

export class ASTService{
    private readonly grammarDir: string;
    private readonly languageCache=new Map<string,TreeSitter.Language>();
    private parser:TreeSitter.Parser|null=null;
    private  currentLanguageId:string|null=null;
    private _isReady=false;

    constructor(extensionPath:string){
        this.grammarDir=path.join(extensionPath,'grammars');
    }   

    async initialize():Promise<void>{
        //wasm path
        const wasmPath=path.join(this.grammarDir,'web-tree-sitter.wasm');
        //initialize tree sitter with web sitter wasm
        await TreeSitter.Parser.init({
            locateFile:()=>wasmPath,
        });

        this.parser=new TreeSitter.Parser();
        this._isReady=true;
    }

    async ensureLanguage(languageId:string):Promise<boolean>{
        //if the parser is not ready,return
        if(!this._isReady||!this.parser)return false;

        //getting current file's language wasm file
        const wasmFile=LANGUAGE_MAP[languageId];
        if(!wasmFile)return false;

        //if cache already has wasm file for that specific language
        if(this.languageCache.has(wasmFile)){
            //if current language is not equal to present file language id (languageId)
            if(this.currentLanguageId!==languageId){
                this.parser.setLanguage(this.languageCache.get(wasmFile)!);
                this.currentLanguageId=languageId;
            }
            return true;
        }


        try {
            const wasmPath=path.join(this.grammarDir,wasmFile);
            //loading tree parser with current file's language wasm file content and getting language
            const language=await TreeSitter.Language.load(wasmPath);
            //caching wasm file
            this.languageCache.set(wasmFile,language);
            //setting language for parser
            this.parser.setLanguage(language);
            this.currentLanguageId=languageId;
            return true;
        } catch (error) {
            return false;
        }
    }

    //parsing tree
    parseSync(code:string):TreeSitter.Tree|null{
        if(!this._isReady||!this.parser)return null;

        return this.parser.parse(code);
    }

    withParsedTree<T>(code: string, fn: (tree: TreeSitter.Tree) => T): T | null {
        const tree = this.parseSync(code);
        if (!tree) return null;
        try {
            return fn(tree);
        } finally {
            tree.delete();
        }
    }

    isReady():boolean{
        return  this._isReady;
    }

    dispose(){
        this.parser?.delete();
        this.parser=null;
        this.languageCache.clear();
        this._isReady=false;
    }
     
}