import * as vscode from 'vscode';
import { getTranslationConfiguration } from './configuration';
import { insertTranslationBelow, replaceEditorSelection } from './editorActions';
import { LANGUAGES, LanguageCode, languageLabel, ProviderId, providerLabel } from './languages';
import { isAbortError, PROVIDER_ORDER, translateText, TranslationChainError } from './translator';

const DEBOUNCE_MS = 400;
const SETTINGS_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('settings-gear'),
	tooltip: vscode.l10n.t('Configure translation services and languages'),
};
const SWAP_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('arrow-swap'),
	tooltip: vscode.l10n.t('Swap primary and secondary languages'),
};
const TARGET_LANGUAGE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('globe'),
	tooltip: vscode.l10n.t('Temporarily select the target language'),
};
const COPY_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('copy'),
	tooltip: vscode.l10n.t('Copy translation'),
};
const REPLACE_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('replace-all'),
	tooltip: vscode.l10n.t('Replace selection with translation'),
};
const INSERT_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('add'),
	tooltip: vscode.l10n.t('Insert translation below selection'),
};
const RETRY_ALL_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('refresh'),
	tooltip: vscode.l10n.t('Retry in the default order'),
};
const ERROR_DETAILS_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('output'),
	tooltip: vscode.l10n.t('View service errors'),
};
const PROVIDER_RETRY_BUTTONS: Record<ProviderId, vscode.QuickInputButton> = {
	microsoft: { iconPath: new vscode.ThemeIcon('server-process'), tooltip: vscode.l10n.t('Retry with Microsoft only') },
	google: { iconPath: new vscode.ThemeIcon('globe'), tooltip: vscode.l10n.t('Retry with Google only') },
	baidu: { iconPath: new vscode.ThemeIcon('symbol-text'), tooltip: vscode.l10n.t('Retry with Baidu only') },
};
const WAITING_ITEM: vscode.QuickPickItem = {
	label: vscode.l10n.t('$(sync~spin) Translating…'),
	description: vscode.l10n.t('Microsoft → Google → Baidu'),
	alwaysShow: true,
};

type TranslationQuickPickItem = vscode.QuickPickItem & {
	temporaryTarget?: LanguageCode | null;
};

export type TranslationQuickPickOptions = {
	initialText?: string;
	sourceEditor?: vscode.TextEditor;
	sourceSelection?: vscode.Selection;
	restoreTranslation?(translatedText: string): string;
};

export function openTranslationQuickPick(options: TranslationQuickPickOptions = {}): vscode.Disposable {
	const quickPick = vscode.window.createQuickPick<TranslationQuickPickItem>();
	const subscriptions: vscode.Disposable[] = [];
	let activeRequest: AbortController | undefined;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let resultText: string | undefined;
	let temporaryTargetLanguage: LanguageCode | undefined;
	let selectingTarget = false;
	let savedTranslationValue = '';
	let lastErrorDetail: string | undefined;
	let suppressValueChange = false;
	let disposed = false;
	const hasSourceSelection = Boolean(options.sourceEditor && options.sourceSelection && !options.sourceSelection.isEmpty);

	function updateTitle(): void {
		const config = getTranslationConfiguration();
		quickPick.title = temporaryTargetLanguage
			? vscode.l10n.t('Quick Translation · Auto → {0}', languageLabel(temporaryTargetLanguage))
			: `Quick Translation · ${languageLabel(config.primaryLanguage)} ⇄ ${languageLabel(config.secondaryLanguage)}`;
	}

	function showTranslationView(value: string): void {
		selectingTarget = false;
		quickPick.placeholder = vscode.l10n.t('Type text and pause briefly to translate');
		quickPick.buttons = [SWAP_BUTTON, TARGET_LANGUAGE_BUTTON, SETTINGS_BUTTON];
		updateTitle();
		suppressValueChange = true;
		quickPick.value = value;
		suppressValueChange = false;
		startTranslation(value);
	}

	function showTargetLanguagePicker(): void {
		cancelRequest();
		resultText = undefined;
		selectingTarget = true;
		savedTranslationValue = quickPick.value;
		quickPick.busy = false;
		quickPick.title = vscode.l10n.t('Select a Target Language for This Translation');
		quickPick.placeholder = vscode.l10n.t('Translate again immediately after selection');
		quickPick.buttons = [vscode.QuickInputButtons.Back];
		quickPick.value = '';

		const config = getTranslationConfiguration();
		const items: TranslationQuickPickItem[] = [{
			label: vscode.l10n.t('Automatic Bidirectional Translation'),
			detail: `${languageLabel(config.primaryLanguage)} ⇄ ${languageLabel(config.secondaryLanguage)}`,
			temporaryTarget: null,
			alwaysShow: true,
		}, ...LANGUAGES.map((language) => ({
			label: language.label,
			description: language.code,
			temporaryTarget: language.code,
			alwaysShow: true,
		}))];
		quickPick.items = items;
		quickPick.activeItems = [items.find((item) => item.temporaryTarget === (temporaryTargetLanguage ?? null)) ?? items[0]];
	}

	function cancelRequest(): void {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = undefined;
		}
		activeRequest?.abort();
		activeRequest = undefined;
	}

	function startTranslation(value: string, providerOverride?: readonly ProviderId[]): void {
		cancelRequest();
		resultText = undefined;
		lastErrorDetail = undefined;

		if (!value.trim()) {
			quickPick.busy = false;
			quickPick.items = [];
			return;
		}

		const request = new AbortController();
		activeRequest = request;
		quickPick.busy = true;
		quickPick.items = [WAITING_ITEM];
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			const config = getTranslationConfiguration();
			const enabledProviders = providerOverride ?? config.enabledProviders;
			void translateText({
				text: value,
				signal: request.signal,
				primaryLanguage: config.primaryLanguage,
				secondaryLanguage: config.secondaryLanguage,
				targetLanguage: temporaryTargetLanguage,
				enabledProviders,
			})
				.then((result) => {
					if (disposed || activeRequest !== request) {
						return;
					}

					resultText = result.text;
					quickPick.busy = false;
					quickPick.items = [{
						label: result.text,
						description: vscode.l10n.t('Press Enter to copy'),
						detail: `${result.detectedLanguage ? languageLabel(result.detectedLanguage) : vscode.l10n.t('Auto Detect')} → ${languageLabel(result.targetLanguage)} · ${providerLabel(result.provider)}`,
						buttons: hasSourceSelection
							? [COPY_BUTTON, REPLACE_BUTTON, INSERT_BUTTON]
							: [COPY_BUTTON],
						alwaysShow: true,
					}];
				})
				.catch((error: unknown) => {
					if (disposed || activeRequest !== request || isAbortError(error)) {
						return;
					}

					lastErrorDetail = error instanceof TranslationChainError
						? error.attempts.map((attempt) => `${attempt.provider}: ${attempt.message}`).join('；')
						: error instanceof Error ? error.message : String(error);
					quickPick.busy = false;
					quickPick.items = [{
						label: vscode.l10n.t('$(error) All translation services are unavailable'),
						detail: lastErrorDetail,
						buttons: [
							RETRY_ALL_BUTTON,
							ERROR_DETAILS_BUTTON,
							...enabledProviders.map((provider) => PROVIDER_RETRY_BUTTONS[provider]),
						],
						alwaysShow: true,
					}];
				});
		}, DEBOUNCE_MS);
	}

	async function handleItemButton(button: vscode.QuickInputButton): Promise<void> {
		if (button === RETRY_ALL_BUTTON) {
			startTranslation(quickPick.value);
			return;
		}
		if (button === ERROR_DETAILS_BUTTON) {
			if (lastErrorDetail) {
				await vscode.window.showErrorMessage(lastErrorDetail, { modal: true });
			}
			return;
		}
		const retryProvider = PROVIDER_ORDER.find((provider) => PROVIDER_RETRY_BUTTONS[provider] === button);
		if (retryProvider) {
			startTranslation(quickPick.value, [retryProvider]);
			return;
		}
		if (!resultText) {
			return;
		}

		if (button === COPY_BUTTON) {
			await vscode.env.clipboard.writeText(resultText);
			quickPick.hide();
			return;
		}

		const editor = options.sourceEditor;
		const selection = options.sourceSelection;
		if (!editor || !selection) {
			return;
		}
		const formattedResult = options.restoreTranslation?.(resultText) ?? resultText;
		const applied = button === REPLACE_BUTTON
			? await replaceEditorSelection(editor, selection, formattedResult)
			: button === INSERT_BUTTON && await insertTranslationBelow(editor, selection, formattedResult);
		if (applied) {
			quickPick.hide();
		} else {
			void vscode.window.showErrorMessage(vscode.l10n.t('Unable to modify the original editor content.'));
		}
	}

	quickPick.placeholder = vscode.l10n.t('Type text and pause briefly to translate');
	quickPick.ignoreFocusOut = false;
	quickPick.matchOnDescription = false;
	quickPick.matchOnDetail = false;
	quickPick.buttons = [SWAP_BUTTON, TARGET_LANGUAGE_BUTTON, SETTINGS_BUTTON];
	quickPick.value = options.initialText ?? '';
	updateTitle();

	const session = new vscode.Disposable(() => {
		if (disposed) {
			return;
		}

		disposed = true;
		cancelRequest();
		subscriptions.forEach((subscription) => subscription.dispose());
		quickPick.dispose();
	});

		subscriptions.push(
		quickPick.onDidChangeValue((value) => {
			if (!selectingTarget && !suppressValueChange) {
				startTranslation(value);
			}
		}),
		quickPick.onDidTriggerButton((button) => {
			if (button === vscode.QuickInputButtons.Back) {
				showTranslationView(savedTranslationValue);
				return;
			}
			if (button === TARGET_LANGUAGE_BUTTON) {
				showTargetLanguagePicker();
				return;
			}
			if (button === SETTINGS_BUTTON) {
				quickPick.hide();
				void vscode.commands.executeCommand('quickTranslation.configure');
				return;
			}
			if (button === SWAP_BUTTON) {
				temporaryTargetLanguage = undefined;
				const config = getTranslationConfiguration();
				const workspaceConfig = vscode.workspace.getConfiguration('quickTranslation');
				void Promise.all([
					workspaceConfig.update('primaryLanguage', config.secondaryLanguage, vscode.ConfigurationTarget.Global),
					workspaceConfig.update('secondaryLanguage', config.primaryLanguage, vscode.ConfigurationTarget.Global),
				]).then(() => {
					if (!disposed) {
						updateTitle();
						startTranslation(quickPick.value);
					}
				});
			}
		}),
		quickPick.onDidTriggerItemButton(({ button }) => {
			void handleItemButton(button).catch((error: unknown) => {
				void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
			});
		}),
		quickPick.onDidAccept(() => {
			if (selectingTarget) {
				const selected = quickPick.activeItems[0];
				if (selected && 'temporaryTarget' in selected) {
					temporaryTargetLanguage = selected.temporaryTarget ?? undefined;
					showTranslationView(savedTranslationValue);
				}
				return;
			}
			if (!resultText) {
				return;
			}

			void vscode.env.clipboard.writeText(resultText);
			quickPick.hide();
		}),
		quickPick.onDidHide(() => session.dispose()),
	);

	quickPick.show();
	if (options.initialText?.trim()) {
		startTranslation(options.initialText);
	}
	return session;
}
