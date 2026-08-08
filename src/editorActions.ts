import * as vscode from 'vscode';

export interface SelectionReplacement {
	selection: vscode.Selection;
	text: string;
}

export function replaceEditorSelections(
	editor: vscode.TextEditor,
	replacements: readonly SelectionReplacement[],
): Thenable<boolean> {
	return editor.edit((edit) => {
		for (const replacement of replacements) {
			edit.replace(replacement.selection, replacement.text);
		}
	});
}

export function replaceEditorSelection(
	editor: vscode.TextEditor,
	selection: vscode.Selection,
	text: string,
): Thenable<boolean> {
	return replaceEditorSelections(editor, [{ selection, text }]);
}

export function insertTranslationBelow(
	editor: vscode.TextEditor,
	selection: vscode.Selection,
	text: string,
): Thenable<boolean> {
	const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
		? selection.end.line - 1
		: selection.end.line;
	const lineEnd = editor.document.lineAt(endLine).range.end;
	return editor.edit((edit) => edit.insert(lineEnd, `\n${text}`));
}
