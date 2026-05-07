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

	//creating accepting command(keybindings registered on package.json)
	const acceptCompletionCommand = vscode.commands.registerCommand(
		'tab-completion.acceptCompletion',
		async () => {
			outputChannel?.appendLine('[Extension] Accept completion command executed');


			//if ther eis no edito or completion provider, no need for command exceution
			const editor = vscode.window.activeTextEditor;
			if (!editor || !provider) {
				outputChannel?.appendLine('[Extension] No editor or provider');
				return;
			}

			const pendingEdit = provider.getPendingEdit();
			//if there is no pending edit, no work for command to work
			if (!pendingEdit) {
				outputChannel?.appendLine('[Extension] No pending edit, falling back to normal tab');
				// No pending completion - execute normal tab behavior
				await vscode.commands.executeCommand('tab');
				return;
			}

			outputChannel?.appendLine(`[Extension] Applying edit: delete ${pendingEdit.deleteRange.start.line}:${pendingEdit.deleteRange.start.character}-${pendingEdit.deleteRange.end.line}:${pendingEdit.deleteRange.end.character}, insert "${pendingEdit.insertText.slice(0, 30)}..."`);

			// Apply the edit
			const success = await editor.edit((editBuilder) => {
				editBuilder.replace(pendingEdit.deleteRange, pendingEdit.insertText);
			}, {
				undoStopBefore: true,
				undoStopAfter: true,
			});

			//if edited, move cursor
			if (success) {
				outputChannel?.appendLine('[Extension] Edit applied successfully');
				// Move cursor to end of inserted text
				const insertLines = pendingEdit.insertText.split('\n');
				const insertEnd = insertLines.length === 1
					? new vscode.Position(pendingEdit.deleteRange.start.line, pendingEdit.deleteRange.start.character + pendingEdit.insertText.length)
					: new vscode.Position(pendingEdit.deleteRange.start.line + insertLines.length - 1, insertLines[insertLines.length - 1].length);
				editor.selection = new vscode.Selection(insertEnd, insertEnd);

				// Record accepted suggestion in intent tracker
				provider.getIntentTracker()?.recordAcceptedSuggestion(
					editor.document.uri.fsPath,
					pendingEdit.deleteRange.start.line + 1,  // 1-indexed
					pendingEdit.insertText
				);
			} else {
				outputChannel?.appendLine('[Extension] Edit failed to apply');
			}

			// Clear completion state (decorations, pending edit, context)
			provider.clearPendingCompletion();
		}
	);

	const rejectCompletionCommand = vscode.commands.registerCommand(
		'tab-completion.rejectCompletion',
		async () => {
			outputChannel?.appendLine('[Extension] Reject completion command executed');

			const editor = vscode.window.activeTextEditor;
			if (!editor || !provider) {
				outputChannel?.appendLine('[Extension] No editor or provider');
				return;
			}

			const pendingEdit = provider.getPendingEdit();
			if (!pendingEdit) {
				outputChannel?.appendLine('[Extension] No pending edit, falling back to normal tab');
				return;
			}

			// Record accepted suggestion in intent tracker
			provider.getIntentTracker()?.recordRejectedSuggestion(
				editor.document.uri.fsPath,
				pendingEdit.deleteRange.start.line + 1,  // 1-indexed
				pendingEdit.insertText
			);


			// Clear completion state (decorations, pending edit, context)
			provider.clearPendingCompletion();
		}
	);

	context.subscriptions.push(providerDisposable, outputChannel, acceptCompletionCommand, rejectCompletionCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
