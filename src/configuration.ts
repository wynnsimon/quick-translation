import * as vscode from 'vscode';
import {
	DEFAULT_PRIMARY_LANGUAGE,
	DEFAULT_SECONDARY_LANGUAGE,
	isLanguageCode,
	LanguageCode,
	languageLabel,
	LANGUAGES,
	ProviderId,
	ProviderMode,
	isProviderMode,
	providerLabel,
} from './languages';
import { PROVIDER_ORDER, translateText } from './translator';

export type TranslationConfiguration = {
	primaryLanguage: LanguageCode;
	secondaryLanguage: LanguageCode;
	providerMode: ProviderMode;
	enabledProviders: readonly ProviderId[];
};

export type ProviderHealth = {
	provider: ProviderId;
	available: boolean;
	durationMs: number;
	detail: string;
};

let automaticProviderOrder: readonly ProviderId[] = PROVIDER_ORDER;
let automaticProviderTest: Promise<readonly ProviderHealth[]> | undefined;
let automaticProviderOrderUpdatedAt = 0;

export const AUTOMATIC_PROVIDER_ORDER_TTL_MS = 10 * 60 * 1_000;

export function isProviderOrderExpired(updatedAt: number, now = Date.now()): boolean {
	return updatedAt > 0 && now - updatedAt >= AUTOMATIC_PROVIDER_ORDER_TTL_MS;
}

export function rankProvidersByLatency(results: readonly ProviderHealth[]): readonly ProviderId[] {
	return [...results]
		.sort((left, right) => Number(right.available) - Number(left.available) || left.durationMs - right.durationMs)
		.map((result) => result.provider);
}

export async function checkProviderHealth(
	provider: ProviderId,
	signal: AbortSignal,
	translator: typeof translateText = translateText,
): Promise<ProviderHealth> {
	const startedAt = Date.now();
	try {
		const result = await translator({
			text: 'hello',
			signal,
			targetLanguage: 'zh-CN',
			enabledProviders: [provider],
		});
		return {
			provider,
			available: true,
			durationMs: Date.now() - startedAt,
			detail: `hello → ${result.text}`,
		};
	} catch (error) {
		return {
			provider,
			available: false,
			durationMs: Date.now() - startedAt,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

function configuration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('quickTranslation');
}

export function getTranslationConfiguration(target?: vscode.ConfigurationTarget): TranslationConfiguration {
	const config = configuration();
	const value = <T>(key: string, fallback?: T): T | undefined => {
		if (target !== vscode.ConfigurationTarget.Global) {
			return config.get<T>(key, fallback as T);
		}
		const inspected = config.inspect<T>(key);
		return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
	};
	const primary = value<unknown>('primaryLanguage');
	const secondary = value<unknown>('secondaryLanguage');
	const providerMode = value<unknown>('providerMode', 'auto');
	const configuredProviders = value<unknown[]>('enabledProviders', [...PROVIDER_ORDER]) ?? [...PROVIDER_ORDER];
	const enabledProviders = [...new Set(configuredProviders.filter((value): value is ProviderId =>
		typeof value === 'string' && PROVIDER_ORDER.includes(value as ProviderId)))];

	return {
		primaryLanguage: isLanguageCode(primary) ? primary : DEFAULT_PRIMARY_LANGUAGE,
		secondaryLanguage: isLanguageCode(secondary) ? secondary : DEFAULT_SECONDARY_LANGUAGE,
		providerMode: isProviderMode(providerMode) ? providerMode : 'auto',
		enabledProviders,
	};
}

export function getProviderOrder(config = getTranslationConfiguration()): readonly ProviderId[] {
	if (config.providerMode === 'fixed') {
		return config.enabledProviders;
	}
	const enabled = new Set(config.enabledProviders);
	return automaticProviderOrder.filter((provider) => enabled.has(provider));
}

export function testAndSelectFastestProvider(
	signal: AbortSignal,
	providers = getTranslationConfiguration().enabledProviders,
	checker: typeof checkProviderHealth = checkProviderHealth,
): Promise<readonly ProviderHealth[]> {
	const test = Promise.all(providers.map((provider) => checker(provider, signal)))
		.then((results) => {
			if (!signal.aborted && automaticProviderTest === test) {
				const ranked = rankProvidersByLatency(results);
				automaticProviderOrder = [...ranked, ...PROVIDER_ORDER.filter((provider) => !ranked.includes(provider))];
				automaticProviderOrderUpdatedAt = Date.now();
			}
			return results;
		})
		.finally(() => {
			if (automaticProviderTest === test) {
				automaticProviderTest = undefined;
			}
		});
	automaticProviderTest = test;
	return test;
}

export async function waitForProviderOrder(
	config = getTranslationConfiguration(),
): Promise<readonly ProviderId[]> {
	if (config.providerMode === 'fixed') {
		return getProviderOrder(config);
	}

	if (!automaticProviderOrderUpdatedAt) {
		if (!automaticProviderTest) {
			void testAndSelectFastestProvider(new AbortController().signal, config.enabledProviders);
		}
		await automaticProviderTest;
	} else if (isProviderOrderExpired(automaticProviderOrderUpdatedAt) && !automaticProviderTest) {
		void testAndSelectFastestProvider(new AbortController().signal, config.enabledProviders);
	}
	return getProviderOrder(config);
}

async function chooseLanguage(
	title: string,
	key: 'primaryLanguage' | 'secondaryLanguage',
	target: vscode.ConfigurationTarget,
): Promise<void> {
	const current = getTranslationConfiguration(target)[key];
	const selected = await vscode.window.showQuickPick(
		LANGUAGES.map((language) => ({
			label: language.label,
			description: language.code,
			code: language.code,
			picked: language.code === current,
		})),
		{ title, placeHolder: vscode.l10n.t('The selection is saved automatically') },
	);
	if (selected) {
		await configuration().update(key, selected.code, target);
	}
}

async function chooseProviders(target: vscode.ConfigurationTarget): Promise<void> {
	const current = getTranslationConfiguration(target);
	const permutations = PROVIDER_ORDER.flatMap((first) => {
		const remaining = PROVIDER_ORDER.filter((provider) => provider !== first);
		return [
			[first],
			...[...remaining].map((second) => [first, second]),
			[first, remaining[0], remaining[1]],
			[first, remaining[1], remaining[0]],
		];
	});
	const selected = await vscode.window.showQuickPick(
		permutations.map((providers) => ({
			label: providers.map(providerLabel).join(' → '),
			description: current.providerMode === 'auto'
				? vscode.l10n.t('{0} automatic test candidates', providers.length)
				: vscode.l10n.t('Fallback order'),
			providers,
			picked: providers.join() === current.enabledProviders.join(),
		})),
		{
			title: current.providerMode === 'auto'
				? vscode.l10n.t('Automatic provider candidates')
				: vscode.l10n.t('Fixed provider fallback order'),
			placeHolder: current.providerMode === 'auto'
				? vscode.l10n.t('The fastest available service is used first')
				: vscode.l10n.t('Services are tried from left to right'),
		},
	);
	if (!selected) {
		return;
	}
	await configuration().update('enabledProviders', selected.providers, target);
}

async function chooseProviderMode(target: vscode.ConfigurationTarget): Promise<void> {
	const current = getTranslationConfiguration(target).providerMode;
	const selected = await vscode.window.showQuickPick([
		{
			label: vscode.l10n.t('Automatic (lowest latency)'),
			description: vscode.l10n.t('Test enabled services and use the fastest available one'),
			mode: 'auto' as ProviderMode,
			picked: current === 'auto',
		},
		{
			label: vscode.l10n.t('Fixed fallback order'),
			description: vscode.l10n.t('Try services in the configured order'),
			mode: 'fixed' as ProviderMode,
			picked: current === 'fixed',
		},
	], { title: vscode.l10n.t('Select translation service') });
	if (selected) {
		await configuration().update('providerMode', selected.mode, target);
	}
}

async function testProviders(): Promise<void> {
	let cancelled = false;
	const results = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Testing Microsoft, Google, and Baidu…'),
		cancellable: true,
	}, async (_progress, token) => {
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => {
			cancelled = true;
			controller.abort();
		});
		try {
			return await testAndSelectFastestProvider(controller.signal, PROVIDER_ORDER);
		} finally {
			cancellation.dispose();
		}
	});

	if (cancelled) {
		return;
	}
	await vscode.window.showQuickPick(results.map((result) => ({
		label: `${result.available ? '$(pass)' : '$(error)'} ${providerLabel(result.provider)}`,
		description: `${result.available ? vscode.l10n.t('Available') : vscode.l10n.t('Unavailable')} · ${result.durationMs}ms`,
		detail: result.detail,
		alwaysShow: true,
	})), { title: vscode.l10n.t('Translation Service Health Check'), placeHolder: vscode.l10n.t('Press Esc to close') });
}

export async function openTranslationConfiguration(): Promise<void> {
	let target = vscode.ConfigurationTarget.Global;
	let scopeLabel = vscode.l10n.t('Global');
	if (vscode.workspace.workspaceFolders?.length) {
		const scope = await vscode.window.showQuickPick([
			{
				label: vscode.l10n.t('$(globe) Global'),
				description: vscode.l10n.t('Available in all workspaces'),
				target: vscode.ConfigurationTarget.Global,
				scopeLabel: vscode.l10n.t('Global'),
			},
			{
				label: vscode.l10n.t('$(folder) Current Workspace'),
				description: vscode.l10n.t('Overrides global settings in this workspace'),
				target: vscode.ConfigurationTarget.Workspace,
				scopeLabel: vscode.l10n.t('Current Workspace'),
			},
		], { title: vscode.l10n.t('Select where to save settings') });
		if (!scope) {
			return;
		}
		target = scope.target;
		scopeLabel = scope.scopeLabel;
	}

	const current = getTranslationConfiguration(target);
	const selected = await vscode.window.showQuickPick([
		{
			label: vscode.l10n.t('$(server-process) Translation Service'),
			description: current.providerMode === 'auto'
				? vscode.l10n.t('Automatic (lowest latency)')
				: vscode.l10n.t('Fixed fallback order'),
			key: 'provider',
		},
		{
			label: current.providerMode === 'auto'
				? vscode.l10n.t('$(list-selection) Automatic Provider Candidates')
				: vscode.l10n.t('$(list-selection) Fixed Provider Order'),
			description: current.enabledProviders.map(providerLabel).join(' → '),
			key: 'providers',
		},
		{
			label: vscode.l10n.t('$(home) Primary Language'),
			description: languageLabel(current.primaryLanguage),
			key: 'primary',
		},
		{
			label: vscode.l10n.t('$(globe) Secondary Language'),
			description: languageLabel(current.secondaryLanguage),
			key: 'secondary',
		},
		{
			label: vscode.l10n.t('$(pulse) Test Translation Services'),
			description: vscode.l10n.t('Check availability and latency for all three services'),
			key: 'health',
		},
		{
			label: vscode.l10n.t('$(settings-gear) Open Full Settings'),
			description: vscode.l10n.t('Edit Quick Translation in VS Code Settings'),
			key: 'settings',
		},
	], { title: vscode.l10n.t('Quick Translation Settings · {0}', scopeLabel) });

	switch (selected?.key) {
		case 'provider':
			await chooseProviderMode(target);
			break;
		case 'providers':
			await chooseProviders(target);
			break;
		case 'primary':
			await chooseLanguage(vscode.l10n.t('Select Primary Language'), 'primaryLanguage', target);
			break;
		case 'secondary':
			await chooseLanguage(vscode.l10n.t('Select Secondary Language'), 'secondaryLanguage', target);
			break;
		case 'health':
			await testProviders();
			break;
		case 'settings':
			await vscode.commands.executeCommand(
				target === vscode.ConfigurationTarget.Workspace
					? 'workbench.action.openWorkspaceSettings'
					: 'workbench.action.openSettings',
				'@ext:local.quick-translation',
			);
			break;
	}
}
