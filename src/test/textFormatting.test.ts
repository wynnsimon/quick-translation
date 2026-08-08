import * as assert from 'assert';
import { prepareTextForTranslation } from '../textFormatting';

suite('Text formatting', () => {
	test('translates only text while preserving code wrappers', () => {
		const comment = prepareTextForTranslation('  // request failed');
		assert.strictEqual(comment.text, 'request failed');
		assert.strictEqual(comment.restore('请求失败'), '  // 请求失败');

		const quoted = prepareTextForTranslation('  "hello";');
		assert.strictEqual(quoted.text, 'hello');
		assert.strictEqual(quoted.restore('你好'), '  "你好";');

		const block = prepareTextForTranslation('/**\n * request failed\n */');
		assert.strictEqual(block.text, 'request failed');
		assert.strictEqual(block.restore('请求失败'), '/**\n * 请求失败\n */');
	});
});
