import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'english',
		files: 'out/test/**/*.test.js',
		launchArgs: ['--locale=en'],
	},
	{
		label: 'zh-cn',
		files: 'out/test/**/*.test.js',
		launchArgs: ['--locale=zh-cn'],
	},
]);
