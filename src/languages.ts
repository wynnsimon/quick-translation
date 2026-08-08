import * as vscode from 'vscode';

export const LANGUAGES = [
	{ code: 'zh-CN', label: vscode.l10n.t('Chinese (Simplified)') },
	{ code: 'zh-TW', label: vscode.l10n.t('Chinese (Traditional)') },
	{ code: 'en', label: 'English' },
	{ code: 'ja', label: vscode.l10n.t('Japanese') },
	{ code: 'ko', label: vscode.l10n.t('Korean') },
	{ code: 'fr', label: vscode.l10n.t('French') },
	{ code: 'de', label: vscode.l10n.t('German') },
	{ code: 'es', label: vscode.l10n.t('Spanish') },
	{ code: 'ru', label: vscode.l10n.t('Russian') },
	{ code: 'pt', label: vscode.l10n.t('Portuguese') },
	{ code: 'it', label: vscode.l10n.t('Italian') },
	{ code: 'ar', label: vscode.l10n.t('Arabic') },
] as const;

export type LanguageCode = typeof LANGUAGES[number]['code'];
export type SourceLanguageCode = LanguageCode | 'auto';
export type ProviderId = 'microsoft' | 'google' | 'baidu';

export const DEFAULT_PRIMARY_LANGUAGE: LanguageCode = 'zh-CN';
export const DEFAULT_SECONDARY_LANGUAGE: LanguageCode = 'en';

export function isLanguageCode(value: unknown): value is LanguageCode {
	return LANGUAGES.some((language) => language.code === value);
}

export function languageLabel(code: LanguageCode): string {
	return LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export function providerLabel(provider: ProviderId): string {
	return provider === 'baidu' ? vscode.l10n.t('Baidu') : provider === 'google' ? 'Google' : 'Microsoft';
}

export function toProviderLanguage(provider: ProviderId, language: SourceLanguageCode): string {
	if (language === 'auto') {
		return 'auto';
	}

	if (provider === 'microsoft') {
		const codes: Partial<Record<LanguageCode, string>> = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };
		return codes[language] ?? language;
	}

	if (provider === 'baidu') {
		return {
			'zh-CN': 'zh',
			'zh-TW': 'cht',
			ja: 'jp',
			ko: 'kor',
			fr: 'fra',
			es: 'spa',
			ru: 'ru',
			pt: 'pt',
			de: 'de',
			it: 'it',
			ar: 'ara',
			en: 'en',
		}[language];
	}

	return language;
}

export function normalizeLanguage(code: string | undefined): LanguageCode | undefined {
	if (!code) {
		return undefined;
	}

	const normalized = code.toLowerCase();
	const aliases: Record<string, LanguageCode> = {
		zh: 'zh-CN',
		'zh-cn': 'zh-CN',
		'zh-hans': 'zh-CN',
		cht: 'zh-TW',
		'zh-tw': 'zh-TW',
		'zh-hant': 'zh-TW',
		jp: 'ja',
		kor: 'ko',
		fra: 'fr',
		spa: 'es',
		ara: 'ar',
	};
	const aliased = aliases[normalized];
	if (aliased) {
		return aliased;
	}

	return LANGUAGES.find((language) => language.code.toLowerCase() === normalized)?.code;
}

export function looksLikeLanguage(text: string, language: LanguageCode): boolean {
	if ((language === 'zh-CN' || language === 'zh-TW') && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
		return false;
	}
	const patterns: Partial<Record<LanguageCode, RegExp>> = {
		'zh-CN': /\p{Script=Han}/u,
		'zh-TW': /\p{Script=Han}/u,
		ja: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
		ko: /\p{Script=Hangul}/u,
		ru: /\p{Script=Cyrillic}/u,
		ar: /\p{Script=Arabic}/u,
	};
	return patterns[language]?.test(text) ?? false;
}
