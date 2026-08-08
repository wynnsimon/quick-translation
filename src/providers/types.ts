import { ProviderId, SourceLanguageCode, LanguageCode } from '../languages';

export type ProviderRequest = {
	text: string;
	sourceLanguage: SourceLanguageCode;
	targetLanguage: LanguageCode;
	signal: AbortSignal;
};

export type ProviderResult = {
	text: string;
	detectedLanguage?: string;
};

export interface TranslationProvider {
	readonly id: ProviderId;
	readonly name: string;
	translate(request: ProviderRequest): Promise<ProviderResult>;
}

export type Fetcher = typeof globalThis.fetch;

export async function responseError(response: Response): Promise<Error> {
	const body = await response.text().catch(() => '');
	return new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
}
