import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
	test('loads the matching runtime localization bundle', () => {
		assert.strictEqual(
			vscode.l10n.t('Copy translation'),
			vscode.env.language.toLowerCase().startsWith('zh-cn') ? '复制译文' : 'Copy translation',
		);
	});

	test('registers translation and configuration commands', async () => {
		const extension = vscode.extensions.getExtension('local.quick-translation');
		assert.ok(extension);
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('quickTranslation.open'));
		assert.ok(commands.includes('quickTranslation.translateSelection'));
		assert.ok(commands.includes('quickTranslation.translateAndReplace'));
		assert.ok(commands.includes('quickTranslation.configure'));
	});
});
