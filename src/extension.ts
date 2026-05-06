import * as vscode from 'vscode';

import { InlineCompletionProvider } from './providers/inlineCompletionProvider';
import { ASTService } from './services/astService';

let provider: InlineCompletionProvider|undefined;
let outputChannel: vscode.OutputChannel | undefined;
let astService:ASTService | undefined;

export function activate(context: vscode.ExtensionContext) {

	outputChannel=vscode.window.createOutputChannel('Tab completion');

	outputChannel.appendLine('Tab Completion activated');

	//Abstarct Syntax tree service and initialization
	astService=new ASTService(context.extensionPath);

	astService.initialize().then(()=>{
		outputChannel?.appendLine('AST Service initialized');

		const activeEditor=vscode.window.activeTextEditor;

		//when extension is started
		//if a new window is opened, checking if the ast service is parsed for that window file's language
		if(activeEditor){
			astService?.ensureLanguage(activeEditor.document.languageId);
		}
	});

	//listener to check window change and load that window file language wasm file in parser
	vscode.window.onDidChangeActiveTextEditor((editor)=>{
		if(editor && astService?.isReady){
			astService.ensureLanguage(editor.document.languageId);
		}
	})

	//Inline completion provider 
	provider=new InlineCompletionProvider(astService,outputChannel);


	//registering Inline Completion provider inside all files and a provider
	const providerDisposable=vscode.languages.registerInlineCompletionItemProvider(
		{pattern:"**"},//placed inside all files
		provider
	)

	//pushing disposable object inside context
	context.subscriptions.push(providerDisposable,outputChannel,provider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
