import * as assert from 'assert';
import * as vscode from 'vscode';
import { checkProviderHealth, getTranslationConfiguration } from '../configuration';

suite('Configuration', () => {
	test('reads settings from the selected configuration scope', async () => {
		const config = vscode.workspace.getConfiguration('quickTranslation');
		const previous = config.inspect('primaryLanguage')?.globalValue;
		try {
			await config.update('primaryLanguage', 'ja', vscode.ConfigurationTarget.Global);
			assert.strictEqual(
				getTranslationConfiguration(vscode.ConfigurationTarget.Global).primaryLanguage,
				'ja',
			);
		} finally {
			await config.update('primaryLanguage', previous, vscode.ConfigurationTarget.Global);
		}
	});

	test('reports provider health and latency', async () => {
		const health = await checkProviderHealth(
			'google',
			new AbortController().signal,
			async () => ({
				text: '你好',
				provider: 'google',
				providerName: 'Google',
				detectedLanguage: 'en',
				targetLanguage: 'zh-CN',
				attempts: [],
			}),
		);

		assert.strictEqual(health.available, true);
		assert.strictEqual(health.provider, 'google');
		assert.ok(health.durationMs >= 0);
		assert.strictEqual(health.detail, 'hello → 你好');
	});
});
