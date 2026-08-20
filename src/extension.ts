import * as vscode from 'vscode';
import {
	getTranslationConfiguration,
	openTranslationConfiguration,
	testAndSelectFastestProvider,
	waitForProviderOrder,
} from './configuration';
import { replaceEditorSelections } from './editorActions';
import { providerLabel } from './languages';
import { prepareTextForTranslation } from './textFormatting';
import { openTranslationQuickPick } from './translationQuickPick';
import { isAbortError, translateText } from './translator';

export function activate(context: vscode.ExtensionContext) {
	let activeSession: vscode.Disposable | undefined;
	let speedTest = new AbortController();

	function refreshAutomaticProvider(): void {
		speedTest.abort();
		speedTest = new AbortController();
		const config = getTranslationConfiguration();
		if (config.providerMode === 'auto') {
			void testAndSelectFastestProvider(speedTest.signal, config.enabledProviders);
		}
	}

	refreshAutomaticProvider();

	function openTranslation(): void {
		const editor = vscode.window.activeTextEditor;
		const selection = editor?.selection;
		const prepared = editor && selection && !selection.isEmpty
			? prepareTextForTranslation(editor.document.getText(selection))
			: undefined;
		activeSession?.dispose();
		activeSession = openTranslationQuickPick({
			initialText: prepared?.text,
			sourceEditor: editor,
			sourceSelection: selection,
			restoreTranslation: prepared?.restore,
		});
	}

	async function translateAndReplace(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const selections = editor?.selections.filter((selection) => !selection.isEmpty) ?? [];
		if (!editor || selections.length === 0) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Select text to translate first.'));
			return;
		}

		const documentVersion = editor.document.version;
		const preparedSelections = selections
			.map((selection) => ({ selection, prepared: prepareTextForTranslation(editor.document.getText(selection)) }))
			.filter(({ prepared }) => prepared.text.trim());
		if (preparedSelections.length === 0) {
			return;
		}

		try {
			const results = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: vscode.l10n.t('Translating and replacing selection…'),
				cancellable: true,
			}, async (_progress, token) => {
				const controller = new AbortController();
				const cancellation = token.onCancellationRequested(() => controller.abort());
				const config = getTranslationConfiguration();
				try {
					return await Promise.all(preparedSelections.map(async ({ selection, prepared }) => ({
						selection,
						prepared,
						result: await translateText({
							text: prepared.text,
							signal: controller.signal,
							primaryLanguage: config.primaryLanguage,
							secondaryLanguage: config.secondaryLanguage,
							enabledProviders: await waitForProviderOrder(config),
						}),
					})));
				} finally {
					cancellation.dispose();
				}
			});

			if (editor.document.version !== documentVersion) {
				void vscode.window.showWarningMessage(vscode.l10n.t('The document changed during translation, so the selection was not replaced.'));
				return;
			}
			const applied = await replaceEditorSelections(editor, results.map(({ selection, prepared, result }) => ({
				selection,
				text: prepared.restore(result.text),
			})));
			if (!applied) {
				throw new Error(vscode.l10n.t('Unable to modify the original editor content.'));
			}
			const providers = [...new Set(results.map(({ result }) => providerLabel(result.provider)))].join(', ');
			vscode.window.setStatusBarMessage(
				results.length === 1
					? vscode.l10n.t('Translated and replaced with {0}', providers)
					: vscode.l10n.t('Translated and replaced {0} selections with {1}', results.length, providers),
				2500,
			);
		} catch (error) {
			if (!isAbortError(error)) {
				void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
			}
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('quickTranslation.open', openTranslation),
		vscode.commands.registerCommand('quickTranslation.translateSelection', openTranslation),
		vscode.commands.registerCommand('quickTranslation.translateAndReplace', translateAndReplace),
		vscode.commands.registerCommand('quickTranslation.configure', openTranslationConfiguration),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('quickTranslation.providerMode')
				|| event.affectsConfiguration('quickTranslation.enabledProviders')) {
				refreshAutomaticProvider();
			}
		}),
		new vscode.Disposable(() => {
			speedTest.abort();
			activeSession?.dispose();
		}),
	);
}
