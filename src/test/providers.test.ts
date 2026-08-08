import * as assert from 'assert';
import { createBaiduProvider } from '../providers/baidu';
import { createGoogleProvider } from '../providers/google';
import { createMicrosoftProvider } from '../providers/microsoft';
import { Fetcher } from '../providers/types';

function request(provider: ReturnType<typeof createMicrosoftProvider>, text = 'hello') {
	return provider.translate({
		text,
		sourceLanguage: 'auto',
		targetLanguage: 'zh-CN',
		signal: new AbortController().signal,
	});
}

suite('Web translation providers', () => {
	test('uses a Microsoft Bing web session and translation endpoint', async () => {
		const calls: string[] = [];
		const requestBodies: string[] = [];
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/translator')) {
				return new Response(`
					<html data-iid="translator.5023">
					<script>IG:"ABCDEF123"; params_AbusePreventionHelper = [${Date.now()},"web-token",3600000];</script>
					</html>
				`, { headers: { 'set-cookie': 'MUID=test-id; Path=/, _EDGE_S=test-edge; Path=/' } });
			}
			requestBodies.push(String(init?.body));
			return Response.json([{
				detectedLanguage: { language: 'en' },
				translations: [{ text: '你好', to: 'zh-Hans' }],
			}]);
		}) as Fetcher;

		const result = await request(createMicrosoftProvider(fetcher));
		assert.strictEqual(calls[0], 'https://www.bing.com/translator');
		assert.ok(calls[1].includes('www.bing.com/ttranslatev3'));
		assert.ok(calls[1].includes('IG=ABCDEF123'));
		assert.ok(calls[1].includes('IID=translator.5023.1'));
		assert.ok(requestBodies[0].includes('fromLang=auto-detect'));
		assert.ok(requestBodies[0].includes('to=zh-Hans'));
		assert.ok(requestBodies[0].includes('token=web-token'));
		assert.deepStrictEqual(result, { text: '你好', detectedLanguage: 'en' });
	});

	test('uses the Google gtx web endpoint', async () => {
		const calls: string[] = [];
		const fetcher = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/translate_a/element.js')) {
				return new Response("tkk='123.456'");
			}
			return Response.json({ sentences: [{ trans: '你好' }], src: 'en' });
		}) as Fetcher;

		const result = await request(createGoogleProvider(fetcher));
		assert.ok(calls[1].includes('/translate_a/single'));
		assert.ok(calls[1].includes('client=gtx'));
		assert.ok(calls[1].includes('tl=zh-CN'));
		assert.deepStrictEqual(result, { text: '你好', detectedLanguage: 'en' });
	});

	test('establishes a Baidu web session before translating', async () => {
		const calls: string[] = [];
		const fetcher = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.includes('/mtpe-individual/multimodal')) {
				return new Response('', {
					headers: {
						'set-cookie': 'BAIDUID=test-id; Path=/, BAIDUID_BFESS=test-bfess; Path=/',
					},
				});
			}
			return Response.json({
				status: 0,
				from: 'en',
				to: 'zh',
				data: [{ src: 'hello', dst: '你好' }],
			});
		}) as Fetcher;

		const result = await request(createBaiduProvider(fetcher));
		assert.ok(calls[0].includes('/mtpe-individual/multimodal'));
		assert.ok(calls[1].endsWith('/transapi'));
		assert.deepStrictEqual(result, { text: '你好', detectedLanguage: 'en' });
	});
});
