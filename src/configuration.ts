import * as vscode from 'vscode';
import {
	DEFAULT_PRIMARY_LANGUAGE,
	DEFAULT_SECONDARY_LANGUAGE,
	isLanguageCode,
	LanguageCode,
	languageLabel,
	LANGUAGES,
	ProviderId,
	providerLabel,
} from './languages';
import { PROVIDER_ORDER, translateText } from './translator';

export type TranslationConfiguration = {
	primaryLanguage: LanguageCode;
	secondaryLanguage: LanguageCode;
	enabledProviders: readonly ProviderId[];
};

export type ProviderHealth = {
	provider: ProviderId;
	available: boolean;
	durationMs: number;
	detail: string;
};

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
	const configuredProviders = value<unknown[]>('enabledProviders', [...PROVIDER_ORDER]) ?? [...PROVIDER_ORDER];
	const enabled = new Set(configuredProviders.filter((value): value is ProviderId =>
		typeof value === 'string' && PROVIDER_ORDER.includes(value as ProviderId)));

	return {
		primaryLanguage: isLanguageCode(primary) ? primary : DEFAULT_PRIMARY_LANGUAGE,
		secondaryLanguage: isLanguageCode(secondary) ? secondary : DEFAULT_SECONDARY_LANGUAGE,
		enabledProviders: PROVIDER_ORDER.filter((provider) => enabled.has(provider)),
	};
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
	const current = new Set(getTranslationConfiguration(target).enabledProviders);
	const selected = await vscode.window.showQuickPick(
		PROVIDER_ORDER.map((provider) => ({
			label: providerLabel(provider),
			description: vscode.l10n.t('Priority {0}', PROVIDER_ORDER.indexOf(provider) + 1),
			provider,
			picked: current.has(provider),
		})),
		{
			title: vscode.l10n.t('Enable translation services (fixed order)'),
			placeHolder: vscode.l10n.t('Microsoft → Google → Baidu'),
			canPickMany: true,
		},
	);
	if (!selected) {
		return;
	}
	if (!selected.length) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Enable at least one translation service.'));
		return;
	}
	const selectedIds = new Set(selected.map((item) => item.provider));
	await configuration().update(
		'enabledProviders',
		PROVIDER_ORDER.filter((provider) => selectedIds.has(provider)),
		target,
	);
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
			return await Promise.all(PROVIDER_ORDER.map((provider) => checkProviderHealth(provider, controller.signal)));
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
			label: vscode.l10n.t('$(server-process) Translation Services'),
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
