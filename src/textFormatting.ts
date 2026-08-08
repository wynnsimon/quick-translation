export type PreparedTranslationText = {
	text: string;
	restore(translatedText: string): string;
};

function identity(text: string): PreparedTranslationText {
	return { text, restore: (translatedText) => translatedText };
}

function withLinePrefixes(prefixes: string[], bodies: string[]): PreparedTranslationText {
	const fallbackPrefix = prefixes.find(Boolean) ?? '';
	return {
		text: bodies.join('\n'),
		restore: (translatedText) => translatedText
			.split('\n')
			.map((line, index) => `${prefixes[index] ?? fallbackPrefix}${line}`)
			.join('\n'),
	};
}

export function prepareTextForTranslation(input: string): PreparedTranslationText {
	const quoted = /^(\s*)(["'`])([\s\S]*)\2([;,]?\s*)$/.exec(input);
	if (quoted) {
		const [, leading, quote, text, trailing] = quoted;
		return {
			text,
			restore: (translatedText) => `${leading}${quote}${translatedText}${quote}${trailing}`,
		};
	}

	const blockComment = /^(\s*\/\*+\s*)([\s\S]*?)(\s*\*\/\s*)$/.exec(input);
	if (blockComment) {
		const [, opening, content, closing] = blockComment;
		const preparedContent = prepareTextForTranslation(content);
		return {
			text: preparedContent.text,
			restore: (translatedText) => `${opening}${preparedContent.restore(translatedText)}${closing}`,
		};
	}

	const lines = input.split('\n');
	const lineComments = lines.map((line) => /^(\s*(?:\/{2,}|#|--)\s?)(.*)$/.exec(line));
	if (lineComments.every((match, index) => Boolean(match) || lines[index].length === 0)) {
		return withLinePrefixes(
			lineComments.map((match) => match?.[1] ?? ''),
			lineComments.map((match) => match?.[2] ?? ''),
		);
	}

	const starredLines = lines.map((line) => /^(\s*\*\s?)(.*)$/.exec(line));
	if (starredLines.every((match, index) => Boolean(match) || lines[index].length === 0)) {
		return withLinePrefixes(
			starredLines.map((match) => match?.[1] ?? ''),
			starredLines.map((match) => match?.[2] ?? ''),
		);
	}

	const indentedLines = lines.map((line) => /^(\s+)(\S.*)$/.exec(line));
	if (lines.length > 1 && indentedLines.some(Boolean)) {
		return withLinePrefixes(
			indentedLines.map((match) => match?.[1] ?? ''),
			indentedLines.map((match, index) => match?.[2] ?? lines[index]),
		);
	}

	return identity(input);
}
