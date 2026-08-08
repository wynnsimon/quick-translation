import * as vscode from 'vscode';
import { toProviderLanguage } from '../languages';
import { Fetcher, ProviderResult, responseError, TranslationProvider } from './types';

const API_URL = 'https://translate.googleapis.com/translate_a/single';
const ELEMENT_URL = 'https://translate.googleapis.com/translate_a/element.js';
const REFERER = 'https://translate.google.com/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36';

type GoogleResponse = {
	sentences?: Array<{ trans?: string }>;
	src?: string;
};

function calculate(value: number, pattern: string): number {
	let result = value;
	for (let index = 0; index <= pattern.length - 3; index += 3) {
		const token = pattern[index + 2];
		const shift = token >= 'a' ? token.charCodeAt(0) - 87 : Number(token);
		const shifted = pattern[index + 1] === '+' ? result >>> shift : result << shift;
		result = pattern[index] === '+' ? (result + shifted) >>> 0 : result ^ shifted;
	}
	return result;
}

export function googleToken(text: string, tkk: readonly [number, number]): string {
	const bytes = new TextEncoder().encode(text);
	let value = tkk[0];
	for (const byte of bytes) {
		value += byte;
		value = calculate(value, '+-a^+6');
	}
	value = calculate(value, '+-3^+b+-f') ^ tkk[1];
	value = value < 0 ? (value & 0x7fffffff) + 0x80000000 : value;
	value %= 1_000_000;
	return `${value}.${value ^ tkk[0]}`;
}

export function createGoogleProvider(fetcher: Fetcher = globalThis.fetch): TranslationProvider {
	let cachedTkk: readonly [number, number] | undefined;

	async function getTkk(signal: AbortSignal): Promise<readonly [number, number]> {
		const hour = Math.trunc(Date.now() / 3_600_000);
		if (cachedTkk?.[0] === hour) {
			return cachedTkk;
		}

		try {
			const response = await fetcher(ELEMENT_URL, {
				headers: { Referer: REFERER, 'User-Agent': USER_AGENT },
				signal,
			});
			if (response.ok) {
				const match = /tkk='(\d+)\.(-?\d+)'/.exec(await response.text());
				if (match) {
					cachedTkk = [Number(match[1]), Number(match[2])];
					return cachedTkk;
				}
			}
		} catch (error) {
			if (signal.aborted) {
				throw error;
			}
		}

		cachedTkk = [hour, Math.trunc(Math.random() * 0x7fffffff)];
		return cachedTkk;
	}

	return {
		id: 'google',
		name: 'Google',
		async translate(request): Promise<ProviderResult> {
			const tkk = await getTkk(request.signal);
			const url = new URL(API_URL);
			url.searchParams.set('client', 'gtx');
			url.searchParams.set('sl', toProviderLanguage('google', request.sourceLanguage));
			url.searchParams.set('tl', toProviderLanguage('google', request.targetLanguage));
			url.searchParams.set('dt', 't');
			url.searchParams.set('dj', '1');
			url.searchParams.set('ie', 'UTF-8');
			url.searchParams.set('oe', 'UTF-8');
			url.searchParams.set('tk', googleToken(request.text, tkk));

			const response = await fetcher(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
					Referer: REFERER,
					'User-Agent': USER_AGENT,
				},
				body: new URLSearchParams({ q: request.text }),
				signal: request.signal,
			});
			if (!response.ok) {
				throw await responseError(response);
			}

			const data = await response.json() as GoogleResponse;
			const text = data.sentences?.map((sentence) => sentence.trans ?? '').join('');
			if (!text) {
				throw new Error(vscode.l10n.t('Google returned no translation.'));
			}
			return { text, detectedLanguage: data.src };
		},
	};
}
