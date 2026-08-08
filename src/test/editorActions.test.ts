import * as assert from 'assert';
import * as vscode from 'vscode';
import { insertTranslationBelow, replaceEditorSelection, replaceEditorSelections } from '../editorActions';

suite('Editor actions', () => {
	test('replaces a selection or inserts the translation below it', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'hello\nnext' });
		const editor = await vscode.window.showTextDocument(document);
		const selection = new vscode.Selection(0, 0, 0, 5);

		assert.strictEqual(await insertTranslationBelow(editor, selection, '你好'), true);
		assert.strictEqual(document.getText(), 'hello\n你好\nnext');
		assert.strictEqual(await replaceEditorSelection(editor, selection, '您好'), true);
		assert.strictEqual(document.getText(), '您好\n你好\nnext');

		const multilineDocument = await vscode.workspace.openTextDocument({ content: 'first\nsecond' });
		const multilineEditor = await vscode.window.showTextDocument(multilineDocument);
		assert.strictEqual(await insertTranslationBelow(
			multilineEditor,
			new vscode.Selection(0, 0, 1, 0),
			'译文',
		), true);
		assert.strictEqual(multilineDocument.getText(), 'first\n译文\nsecond');
	});

	test('replaces multiple editor selections in one edit', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'hello and world' });
		const editor = await vscode.window.showTextDocument(document);
		const applied = await replaceEditorSelections(editor, [
			{ selection: new vscode.Selection(0, 0, 0, 5), text: '你好' },
			{ selection: new vscode.Selection(0, 10, 0, 15), text: '世界' },
		]);

		assert.strictEqual(applied, true);
		assert.strictEqual(document.getText(), '你好 and 世界');
	});
});
