import * as assert from 'assert';
import { ProviderId } from '../languages';
import { TranslationProvider } from '../providers/types';
import { PROVIDER_ORDER, translateText, TranslationChainError } from '../translator';

function provider(
	id: ProviderId,
	translate: TranslationProvider['translate'],
): TranslationProvider {
	return { id, name: id, translate };
}

suite('Translator', () => {
	test('falls back in Microsoft, Google, Baidu order', async () => {
		const calls: ProviderId[] = [];
		const providers = [...PROVIDER_ORDER].reverse().map((id) => provider(id, async () => {
			calls.push(id);
			if (id !== 'baidu') {
				throw new Error(`${id} unavailable`);
			}
			return { text: '你好', detectedLanguage: 'en' };
		}));

		const result = await translateText({
			text: 'hello',
			signal: new AbortController().signal,
			providers,
		});

		assert.deepStrictEqual(calls, ['microsoft', 'google', 'baidu']);
		assert.strictEqual(result.provider, 'baidu');
		assert.strictEqual(result.text, '你好');
		assert.deepStrictEqual(result.attempts.map((attempt) => attempt.provider), ['microsoft', 'google']);
	});

	test('reports every failed provider', async () => {
		const providers = PROVIDER_ORDER.map((id) => provider(id, async () => {
			throw new Error(`${id} unavailable`);
		}));

		await assert.rejects(
			translateText({ text: 'hello', signal: new AbortController().signal, providers }),
			(error: unknown) => error instanceof TranslationChainError
				&& error.attempts.map((attempt) => attempt.provider).join(',') === 'microsoft,google,baidu',
		);
	});

	test('automatically translates Chinese to the secondary language', async () => {
		let target = '';
		const microsoft = provider('microsoft', async (request) => {
			target = request.targetLanguage;
			return { text: 'hello', detectedLanguage: 'zh-Hans' };
		});

		const result = await translateText({
			text: '你好',
			signal: new AbortController().signal,
			providers: [microsoft],
			enabledProviders: ['microsoft'],
		});

		assert.strictEqual(target, 'en');
		assert.strictEqual(result.targetLanguage, 'en');
	});

	test('temporarily forces a target language', async () => {
		let target = '';
		const microsoft = provider('microsoft', async (request) => {
			target = request.targetLanguage;
			return { text: 'こんにちは', detectedLanguage: 'en' };
		});

		const result = await translateText({
			text: 'hello',
			signal: new AbortController().signal,
			targetLanguage: 'ja',
			providers: [microsoft],
			enabledProviders: ['microsoft'],
		});

		assert.strictEqual(target, 'ja');
		assert.strictEqual(result.targetLanguage, 'ja');
	});

	test('aborting stops the fallback chain', async () => {
		const controller = new AbortController();
		const calls: ProviderId[] = [];
		const providers = PROVIDER_ORDER.map((id) => provider(id, (request) => new Promise((_, reject) => {
			calls.push(id);
			request.signal.addEventListener('abort', () => {
				const error = new Error('aborted');
				error.name = 'AbortError';
				reject(error);
			}, { once: true });
		})));

		const translation = translateText({ text: 'hello', signal: controller.signal, providers });
		controller.abort();
		await assert.rejects(translation, (error: unknown) =>
			error instanceof Error && error.name === 'AbortError');
		assert.deepStrictEqual(calls, ['microsoft']);
	});
});
