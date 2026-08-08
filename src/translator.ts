import * as vscode from 'vscode';
import {
	DEFAULT_PRIMARY_LANGUAGE,
	DEFAULT_SECONDARY_LANGUAGE,
	LanguageCode,
	looksLikeLanguage,
	normalizeLanguage,
	ProviderId,
} from './languages';
import { createBaiduProvider } from './providers/baidu';
import { createGoogleProvider } from './providers/google';
import { createMicrosoftProvider } from './providers/microsoft';
import { TranslationProvider } from './providers/types';

export const PROVIDER_ORDER: readonly ProviderId[] = ['microsoft', 'google', 'baidu'];

const DEFAULT_PROVIDERS: readonly TranslationProvider[] = [
	createMicrosoftProvider(),
	createGoogleProvider(),
	createBaiduProvider(),
];

export type TranslationRequest = {
	text: string;
	signal: AbortSignal;
	primaryLanguage?: LanguageCode;
	secondaryLanguage?: LanguageCode;
	targetLanguage?: LanguageCode;
	enabledProviders?: readonly ProviderId[];
	providers?: readonly TranslationProvider[];
	providerTimeoutMs?: number;
};

export type TranslationAttempt = {
	provider: ProviderId;
	message: string;
};

export type TranslationResult = {
	text: string;
	provider: ProviderId;
	providerName: string;
	detectedLanguage?: LanguageCode;
	targetLanguage: LanguageCode;
	attempts: readonly TranslationAttempt[];
};

export class TranslationChainError extends Error {
	constructor(public readonly attempts: readonly TranslationAttempt[]) {
		super(attempts.map((attempt) => `${attempt.provider}: ${attempt.message}`).join('；'));
		this.name = 'TranslationChainError';
	}
}

function abortError(): Error {
	const error = new Error('Translation request was aborted.');
	error.name = 'AbortError';
	return error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runWithTimeout<T>(
	signal: AbortSignal,
	timeoutMs: number,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	if (signal.aborted) {
		throw abortError();
	}

	const controller = new AbortController();
	let timedOut = false;
	const abort = () => controller.abort();
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	signal.addEventListener('abort', abort, { once: true });

	try {
		return await run(controller.signal);
	} catch (error) {
		if (signal.aborted) {
			throw abortError();
		}
		if (timedOut) {
			throw new Error(vscode.l10n.t('Request timed out after {0} seconds.', timeoutMs / 1_000));
		}
		throw error;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', abort);
	}
}

async function translateTo(
	text: string,
	targetLanguage: LanguageCode,
	request: Required<Pick<TranslationRequest, 'signal' | 'providerTimeoutMs'>> & {
		providers: readonly TranslationProvider[];
		enabledProviders: readonly ProviderId[];
	},
): Promise<TranslationResult> {
	const attempts: TranslationAttempt[] = [];
	const enabled = new Set(request.enabledProviders);
	const providersById = new Map(request.providers.map((provider) => [provider.id, provider]));

	for (const providerId of PROVIDER_ORDER) {
		if (!enabled.has(providerId)) {
			continue;
		}
		const provider = providersById.get(providerId);
		if (!provider) {
			continue;
		}

		try {
			const result = await runWithTimeout(request.signal, request.providerTimeoutMs, (signal) =>
				provider.translate({ text, sourceLanguage: 'auto', targetLanguage, signal }));
			return {
				text: result.text,
				provider: provider.id,
				providerName: provider.name,
				detectedLanguage: normalizeLanguage(result.detectedLanguage),
				targetLanguage,
				attempts,
			};
		} catch (error) {
			if (request.signal.aborted || isAbortError(error)) {
				throw abortError();
			}
			attempts.push({ provider: provider.id, message: errorMessage(error) });
		}
	}

	throw new TranslationChainError(attempts.length ? attempts : [{
		provider: 'microsoft',
		message: vscode.l10n.t('No translation service is enabled.'),
	}]);
}

export async function translateText({
	text,
	signal,
	primaryLanguage = DEFAULT_PRIMARY_LANGUAGE,
	secondaryLanguage = DEFAULT_SECONDARY_LANGUAGE,
	targetLanguage,
	enabledProviders = PROVIDER_ORDER,
	providers = DEFAULT_PROVIDERS,
	providerTimeoutMs = 8_000,
}: TranslationRequest): Promise<TranslationResult> {
	if (!text.trim()) {
		throw new Error('Translation text is required.');
	}

	const request = { signal, providerTimeoutMs, enabledProviders, providers };
	if (targetLanguage) {
		return translateTo(text, targetLanguage, request);
	}
	if (looksLikeLanguage(text, primaryLanguage)) {
		return translateTo(text, secondaryLanguage, request);
	}

	const initial = await translateTo(text, primaryLanguage, request);
	if (initial.detectedLanguage === primaryLanguage && primaryLanguage !== secondaryLanguage) {
		const reversed = await translateTo(text, secondaryLanguage, request);
		return { ...reversed, attempts: [...initial.attempts, ...reversed.attempts] };
	}
	return initial;
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
