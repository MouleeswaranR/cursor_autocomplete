import * as vscode from 'vscode';

import { InlineCompletionProvider } from './providers/inlineCompletionProvider';

let provider: InlineCompletionProvider|undefined;
let outputChannel: vscode.OutputChannel | undefined;
export function activate(context: vscode.ExtensionContext) {

	outputChannel=vscode.window.createOutputChannel('Tab completion');

	outputChannel.appendLine('Tab Completion activated');
	//Inline completion provider 
	provider=new InlineCompletionProvider(outputChannel);

	//registering Inline Completion provider inside all files and a provider
	const providerDisposable=vscode.languages.registerInlineCompletionItemProvider(
		{pattern:"**"},//placed inside all files
		provider
	)

	//pushing disposable object inside context
	context.subscriptions.push(providerDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
