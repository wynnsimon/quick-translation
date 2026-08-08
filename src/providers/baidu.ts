import * as vscode from 'vscode';
import { toProviderLanguage } from '../languages';
import { Fetcher, ProviderResult, responseError, TranslationProvider } from './types';

const HOME_URL = 'https://fanyi.baidu.com/mtpe-individual/multimodal';
const API_URL = 'https://fanyi.baidu.com/transapi';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36';

type BaiduResponse = {
	status?: number;
	errno?: number;
	errmsg?: string;
	from?: string;
	data?: Array<{ dst?: string }>;
};

function extractCookies(header: string): string {
	return ['BAIDUID', 'BAIDUID_BFESS', 'AIT_PERSONAL_VERSION', 'AIT_ENTERPRISE_VERSION']
		.map((name) => {
			const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(header);
			return match ? `${name}=${match[1]}` : undefined;
		})
		.filter((cookie): cookie is string => Boolean(cookie))
		.join('; ');
}

export function createBaiduProvider(fetcher: Fetcher = globalThis.fetch): TranslationProvider {
	let session: { cookie: string; expiresAt: number } | undefined;

	async function getCookie(signal: AbortSignal, force = false): Promise<string> {
		if (!force && session && Date.now() < session.expiresAt) {
			return session.cookie;
		}

		const response = await fetcher(HOME_URL, {
			headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
			signal,
		});
		if (!response.ok) {
			throw await responseError(response);
		}
		const cookie = extractCookies(response.headers.get('set-cookie') ?? '');
		await response.body?.cancel();
		if (!cookie) {
			throw new Error(vscode.l10n.t('Baidu did not establish a web translation session.'));
		}
		session = { cookie, expiresAt: Date.now() + 30 * 60_000 };
		return cookie;
	}

	async function requestTranslation(
		request: Parameters<TranslationProvider['translate']>[0],
		forceSession = false,
	): Promise<BaiduResponse> {
		const cookie = await getCookie(request.signal, forceSession);
		const response = await fetcher(API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				Cookie: cookie,
				Origin: 'https://fanyi.baidu.com',
				Referer: HOME_URL,
				'User-Agent': USER_AGENT,
			},
			body: new URLSearchParams({
				from: toProviderLanguage('baidu', request.sourceLanguage),
				to: toProviderLanguage('baidu', request.targetLanguage),
				query: request.text,
				source: 'txt',
			}),
			signal: request.signal,
		});
		if (!response.ok) {
			throw await responseError(response);
		}
		return response.json() as Promise<BaiduResponse>;
	}

	return {
		id: 'baidu',
		name: 'Baidu',
		async translate(request): Promise<ProviderResult> {
			let data = await requestTranslation(request);
			if (data.errno === 1022) {
				session = undefined;
				data = await requestTranslation(request, true);
			}

			if (data.status !== 0 || data.errno) {
				throw new Error(data.errmsg ?? vscode.l10n.t('Baidu web API error: {0}', data.errno ?? data.status ?? 'unknown'));
			}
			const text = data.data?.map((item) => item.dst ?? '').join('\n');
			if (!text) {
				throw new Error(vscode.l10n.t('Baidu returned no translation.'));
			}
			return { text, detectedLanguage: data.from };
		},
	};
}
