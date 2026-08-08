import * as vscode from 'vscode';
import { toProviderLanguage } from '../languages';
import { Fetcher, ProviderRequest, ProviderResult, responseError, TranslationProvider } from './types';

const HOME_URL = 'https://www.bing.com/translator';
const TRANSLATE_URL = 'https://www.bing.com/ttranslatev3';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

type MicrosoftResponse = Array<{
	detectedLanguage?: { language?: string };
	translations?: Array<{ text?: string }>;
}> | { ShowCaptcha?: boolean };

type MicrosoftSession = {
	ig: string;
	iid: string;
	key: string;
	token: string;
	cookie: string;
	expiresAt: number;
};

function extractCookies(header: string): string {
	const cookies = new Map<string, string>();
	for (const match of header.matchAll(/(?:^|,\s*)([\w-]+)=([^;]+)/g)) {
		cookies.set(match[1], `${match[1]}=${match[2]}`);
	}
	return [...cookies.values()].join('; ');
}

function parseSession(html: string, cookie: string): MicrosoftSession {
	const ig = /IG:"([A-F0-9]+)"/.exec(html)?.[1];
	const iid = /data-iid="(translator\.\d+)"/.exec(html)?.[1];
	const abusePrevention = /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/.exec(html);
	if (!ig || !iid || !abusePrevention) {
		throw new Error(vscode.l10n.t('Microsoft web translation session parameters have changed.'));
	}

	const [, key, token, lifetime] = abusePrevention;
	return {
		ig,
		iid,
		key,
		token,
		cookie,
		expiresAt: Math.min(Number(key) + Number(lifetime) - 60_000, Date.now() + 30 * 60_000),
	};
}

export function createMicrosoftProvider(fetcher: Fetcher = globalThis.fetch): TranslationProvider {
	let session: MicrosoftSession | undefined;

	async function getSession(signal: AbortSignal, force = false): Promise<MicrosoftSession> {
		if (!force && session && Date.now() < session.expiresAt) {
			return session;
		}

		const response = await fetcher(HOME_URL, {
			headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
			signal,
		});
		if (!response.ok) {
			throw await responseError(response);
		}
		const cookie = extractCookies(response.headers.get('set-cookie') ?? '');
		const html = await response.text();
		session = parseSession(html, cookie);
		return session;
	}

	async function requestTranslation(request: ProviderRequest, forceSession = false): Promise<MicrosoftResponse> {
		const currentSession = await getSession(request.signal, forceSession);
		const url = new URL(TRANSLATE_URL);
		url.searchParams.set('isVertical', '1');
		url.searchParams.set('IG', currentSession.ig);
		url.searchParams.set('IID', `${currentSession.iid}.1`);

		const response = await fetcher(url, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: currentSession.cookie,
				Origin: 'https://www.bing.com',
				Referer: HOME_URL,
				'User-Agent': USER_AGENT,
			},
			body: new URLSearchParams({
				fromLang: request.sourceLanguage === 'auto'
					? 'auto-detect'
					: toProviderLanguage('microsoft', request.sourceLanguage),
				to: toProviderLanguage('microsoft', request.targetLanguage),
				text: request.text,
				token: currentSession.token,
				key: currentSession.key,
			}),
			signal: request.signal,
		});
		if (!response.ok) {
			throw await responseError(response);
		}
		return response.json() as Promise<MicrosoftResponse>;
	}

	return {
		id: 'microsoft',
		name: 'Microsoft',
		async translate(request): Promise<ProviderResult> {
			let data = await requestTranslation(request);
			if (!Array.isArray(data)) {
				session = undefined;
				data = await requestTranslation(request, true);
			}

			if (!Array.isArray(data)) {
				throw new Error(vscode.l10n.t('Microsoft web translation requires a CAPTCHA.'));
			}
			const text = data[0]?.translations?.[0]?.text;
			if (!text) {
				throw new Error(vscode.l10n.t('Microsoft returned no translation.'));
			}
			return { text, detectedLanguage: data[0]?.detectedLanguage?.language };
		},
	};
}
