/**
 * Diff generation and replace-mode utilities.
 */
import * as Diff from "diff";
import { DEFAULT_FUZZY_THRESHOLD, findMatch, type FuzzyMatch } from "./fuzzy";
import { adjustIndentation, normalizeToLF } from "./normalize";

export interface DiffResult {
	diff: string;
	firstChangedLine: number | undefined;
}

export interface ReplaceOptions {
	fuzzy: boolean;
	all: boolean;
	threshold?: number;
}

export interface ReplaceResult {
	content: string;
	count: number;
}

function countContentLines(content: string): number {
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return Math.max(1, lines.length);
}

function formatNumberedDiffLine(prefix: "+" | "-" | " ", lineNum: number, width: number, content: string): string {
	const padded = String(lineNum).padStart(width, " ");
	return `${prefix}${padded}|${content}`;
}

export function generateDiffString(oldContent: string, newContent: string, contextLines = 4): DiffResult {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];
	const maxLineNum = Math.max(countContentLines(oldContent), countContentLines(newContent));
	const lineNumWidth = String(maxLineNum).length;
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added || part.removed) {
			if (firstChangedLine === undefined) firstChangedLine = newLineNum;
			for (const line of raw) {
				if (part.added) {
					output.push(formatNumberedDiffLine("+", newLineNum, lineNumWidth, line));
					newLineNum++;
				} else {
					output.push(formatNumberedDiffLine("-", oldLineNum, lineNumWidth, line));
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
			if (lastWasChange || nextPartIsChange) {
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;
				if (!lastWasChange) {
					skipStart = Math.max(0, raw.length - contextLines);
					linesToShow = raw.slice(skipStart);
				}
				if (!nextPartIsChange && linesToShow.length > contextLines) {
					skipEnd = linesToShow.length - contextLines;
					linesToShow = linesToShow.slice(0, contextLines);
				}
				if (skipStart > 0) {
					output.push(formatNumberedDiffLine(" ", oldLineNum, lineNumWidth, "..."));
					oldLineNum += skipStart;
					newLineNum += skipStart;
				}
				for (const line of linesToShow) {
					output.push(formatNumberedDiffLine(" ", oldLineNum, lineNumWidth, line));
					oldLineNum++;
					newLineNum++;
				}
				if (skipEnd > 0) {
					output.push(formatNumberedDiffLine(" ", oldLineNum, lineNumWidth, "..."));
					oldLineNum += skipEnd;
					newLineNum += skipEnd;
				}
			} else {
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}
			lastWasChange = false;
		}
	}
	return { diff: output.join("\n"), firstChangedLine };
}

export function replaceText(content: string, oldText: string, newText: string, options: ReplaceOptions): ReplaceResult {
	if (oldText.length === 0) throw new Error("oldText must not be empty.");
	const threshold = options.threshold ?? DEFAULT_FUZZY_THRESHOLD;
	let normalizedContent = normalizeToLF(content);
	const normalizedOldText = normalizeToLF(oldText);
	const normalizedNewText = normalizeToLF(newText);
	let count = 0;

	if (options.all) {
		const exactCount = normalizedContent.split(normalizedOldText).length - 1;
		if (exactCount > 0) {
			return {
				content: normalizedContent.split(normalizedOldText).join(normalizedNewText),
				count: exactCount,
			};
		}
		while (true) {
			const matchOutcome = findMatch(normalizedContent, normalizedOldText, { allowFuzzy: options.fuzzy, threshold });
			const shouldUseClosest =
				options.fuzzy &&
				matchOutcome.closest &&
				matchOutcome.closest.confidence >= threshold &&
				(matchOutcome.fuzzyMatches === undefined || matchOutcome.fuzzyMatches <= 1);
			const match = matchOutcome.match || (shouldUseClosest ? matchOutcome.closest : undefined);
			if (!match) break;
			const adjustedNewText = adjustIndentation(normalizedOldText, match.actualText, normalizedNewText);
			if (adjustedNewText === match.actualText) break;
			normalizedContent =
				normalizedContent.substring(0, match.startIndex) +
				adjustedNewText +
				normalizedContent.substring(match.startIndex + match.actualText.length);
			count++;
		}
		return { content: normalizedContent, count };
	}

	const matchOutcome = findMatch(normalizedContent, normalizedOldText, { allowFuzzy: options.fuzzy, threshold });
	if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
		const previews = matchOutcome.occurrencePreviews?.join("\n\n") ?? "";
		const moreMsg = matchOutcome.occurrences > 5 ? ` (showing first 5 of ${matchOutcome.occurrences})` : "";
		throw new Error(
			`Found ${matchOutcome.occurrences} occurrences${moreMsg}:\n\n${previews}\n\nAdd more context lines to disambiguate.`,
		);
	}
	if (!matchOutcome.match) return { content: normalizedContent, count: 0 };

	const match = matchOutcome.match;
	const adjustedNewText = adjustIndentation(normalizedOldText, match.actualText, normalizedNewText);
	normalizedContent =
		normalizedContent.substring(0, match.startIndex) +
		adjustedNewText +
		normalizedContent.substring(match.startIndex + match.actualText.length);
	return { content: normalizedContent, count: 1 };
}
