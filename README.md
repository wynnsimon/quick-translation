# Quick Translation

English | [简体中文](README.zh-CN.md)

A disposable VS Code translation popup that requires no API key. It tries web translation services in a fixed order:

1. Microsoft (Bing Translator)
2. Google Translate
3. Baidu Translate

If a service times out or fails, the extension automatically tries the next one. The UI supports English and Simplified Chinese and follows the VS Code display language.

## Usage

- Open any text editor and click the translation icon in the editor title bar.
- If text is selected, the popup fills it in and starts translating automatically.
- You can also right-click a selection and choose `Quick Translation: Translate Selection`.
- Run `Quick Translation: Translate and Replace Selection` to translate and atomically replace every non-empty selection without opening the popup.
- Run `Quick Translation: Open Translation` from the Command Palette.
- Open translation: `Cmd+Shift+Y` (macOS) / `Ctrl+Shift+Y` (Windows and Linux).
- Translate and replace all selections: `Cmd+Option+Shift+Y` (macOS) / `Ctrl+Alt+Shift+Y` (Windows and Linux).
- Open configuration: `Cmd+K Cmd+Y` (macOS) / `Ctrl+K Ctrl+Y` (Windows and Linux).
- Type text and pause for about 400 ms; the result appears in the same popup.
- Press Enter after a result appears to copy its plain text and close the popup.
- Result buttons can copy, replace the original selection, or insert the translation below it.
- Replacement preserves common line comments, block comments, indentation, and string quotes.
- Click outside the popup or press Esc to close it immediately.

VS Code title-bar buttons do not provide reliable long-press or double-click events, so configuration uses native interactions:

- `Option/Alt + click` the translation icon to open quick configuration.
- Click the gear button in the translation popup.
- Run `Quick Translation: Configure Translation`.

The swap button exchanges the primary and secondary languages immediately. The language button chooses a target for the current translation only. If every service fails, you can inspect errors, retry all services, or retry one provider.

## Languages and Providers

The primary language defaults to Simplified Chinese and the secondary language to English. Text in the primary language is translated to the secondary language; other input is translated to the primary language.

Quick configuration lets you:

- Save settings globally or in the current workspace; workspace settings follow native VS Code precedence and override global settings
- Enable providers (the effective order is always Microsoft → Google → Baidu)
- Choose the primary language
- Choose the secondary language
- Test live availability and latency for Microsoft, Google, and Baidu

Supported languages: Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Portuguese, Italian, and Arabic. You can also search for `Quick Translation` in VS Code Settings.

## Web Translation Notice

This extension emulates public requests made by provider websites. It does not use official commercial APIs and does not require user credentials. Text is sent to enabled services in order, stopping after the first successful response.

Web endpoints may change and may be affected by network conditions, region restrictions, rate limits, or CAPTCHA challenges. Failures trigger the next provider. Do not translate sensitive information or use the extension for high-frequency batch requests.

## Development

The project uses Node.js 22, pnpm, TypeScript, and esbuild:

```bash
fnm use
corepack pnpm install
corepack pnpm run compile
```

Press F5 to launch the Extension Development Host. Run `corepack pnpm run package:vsix` to produce an installable VSIX.
