import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	AUTOMATIC_PROVIDER_ORDER_TTL_MS,
	checkProviderHealth,
	getProviderOrder,
	getTranslationConfiguration,
	isProviderOrderExpired,
	rankProvidersByLatency,
} from '../configuration';

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

	test('ranks available providers by latency before unavailable providers', () => {
		assert.deepStrictEqual(rankProvidersByLatency([
			{ provider: 'microsoft', available: true, durationMs: 80, detail: '' },
			{ provider: 'google', available: false, durationMs: 20, detail: '' },
			{ provider: 'baidu', available: true, durationMs: 30, detail: '' },
		]), ['baidu', 'microsoft', 'google']);
	});

	test('expires an automatic provider order after ten minutes', () => {
		const measuredAt = 1_000;
		assert.strictEqual(isProviderOrderExpired(measuredAt, measuredAt + AUTOMATIC_PROVIDER_ORDER_TTL_MS - 1), false);
		assert.strictEqual(isProviderOrderExpired(measuredAt, measuredAt + AUTOMATIC_PROVIDER_ORDER_TTL_MS), true);
	});

	test('uses the configured fallback order in fixed mode', async () => {
		const config = vscode.workspace.getConfiguration('quickTranslation');
		const previousMode = config.inspect('providerMode')?.globalValue;
		const previousProviders = config.inspect('enabledProviders')?.globalValue;
		try {
			await config.update('providerMode', 'fixed', vscode.ConfigurationTarget.Global);
			await config.update('enabledProviders', ['baidu', 'google'], vscode.ConfigurationTarget.Global);
			assert.deepStrictEqual(
				getProviderOrder(getTranslationConfiguration(vscode.ConfigurationTarget.Global)),
				['baidu', 'google'],
			);
		} finally {
			await config.update('providerMode', previousMode, vscode.ConfigurationTarget.Global);
			await config.update('enabledProviders', previousProviders, vscode.ConfigurationTarget.Global);
		}
	});
});
