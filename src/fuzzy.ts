/**
 * Fuzzy matching utilities for the edit tool.
 *
 * Provides both character-level and line-level fuzzy matching with progressive
 * fallback strategies for finding text in files.
 */
import { countLeadingWhitespace, normalizeForFuzzy, normalizeUnicode } from "./normalize";

// Constants

export const DEFAULT_FUZZY_THRESHOLD = 0.95;
const SEQUENCE_FUZZY_THRESHOLD = 0.92;
const FALLBACK_THRESHOLD = 0.8;
const PARTIAL_MATCH_MIN_LENGTH = 6;
const PARTIAL_MATCH_MIN_RATIO = 0.3;
const OCCURRENCE_PREVIEW_CONTEXT = 5;
const OCCURRENCE_PREVIEW_MAX_LEN = 80;

// Types

export interface FuzzyMatch {
	actualText: string;
	startIndex: number;
	startLine: number;
	confidence: number;
}

export interface MatchOutcome {
	match?: FuzzyMatch;
	closest?: FuzzyMatch;
	occurrences?: number;
	occurrenceLines?: number[];
	occurrencePreviews?: string[];
	fuzzyMatches?: number;
	dominantFuzzy?: boolean;
}

// Core Algorithms

export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const aLen = a.length;
	const bLen = b.length;
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	let prev = new Array<number>(bLen + 1);
	let curr = new Array<number>(bLen + 1);
	for (let j = 0; j <= bLen; j++) prev[j] = j;

	for (let i = 1; i <= aLen; i++) {
		curr[0] = i;
		const aCode = a.charCodeAt(i - 1);
		for (let j = 1; j <= bLen; j++) {
			const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
			const deletion = prev[j] + 1;
			const insertion = curr[j - 1] + 1;
			const substitution = prev[j - 1] + cost;
			curr[j] = Math.min(deletion, insertion, substitution);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}
	return prev[bLen];
}

export function similarity(a: string, b: string): number {
	if (a.length === 0 && b.length === 0) return 1;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const distance = levenshteinDistance(a, b);
	return 1 - distance / maxLen;
}

// Line-Based Utilities

function computeRelativeIndentDepths(lines: string[]): number[] {
	const indents = lines.map(countLeadingWhitespace);
	const nonEmptyIndents: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().length > 0) nonEmptyIndents.push(indents[i]);
	}
	const minIndent = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0;
	const indentSteps = nonEmptyIndents.map((indent) => indent - minIndent).filter((step) => step > 0);
	const indentUnit = indentSteps.length > 0 ? Math.min(...indentSteps) : 1;
	return lines.map((line, index) => {
		if (line.trim().length === 0) return 0;
		if (indentUnit <= 0) return 0;
		const relativeIndent = indents[index] - minIndent;
		return Math.round(relativeIndent / indentUnit);
	});
}

function normalizeLines(lines: string[], includeDepth = true): string[] {
	const indentDepths = includeDepth ? computeRelativeIndentDepths(lines) : null;
	return lines.map((line, index) => {
		const trimmed = line.trim();
		const prefix = indentDepths ? `${indentDepths[index]}|` : "|";
		if (trimmed.length === 0) return prefix;
		return `${prefix}${normalizeForFuzzy(trimmed)}`;
	});
}

function computeLineOffsets(lines: string[]): number[] {
	const offsets: number[] = [];
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		offsets.push(offset);
		offset += lines[i].length;
		if (i < lines.length - 1) offset += 1;
	}
	return offsets;
}

// Character-Level Fuzzy Match

interface BestFuzzyMatchResult {
	best?: FuzzyMatch;
	aboveThresholdCount: number;
	secondBestScore: number;
}

function findBestFuzzyMatchCore(
	contentLines: string[],
	targetLines: string[],
	offsets: number[],
	threshold: number,
	includeDepth: boolean,
): BestFuzzyMatchResult {
	const targetNormalized = normalizeLines(targetLines, includeDepth);
	let best: FuzzyMatch | undefined;
	let bestScore = -1;
	let secondBestScore = -1;
	let aboveThresholdCount = 0;

	for (let start = 0; start <= contentLines.length - targetLines.length; start++) {
		const windowLines = contentLines.slice(start, start + targetLines.length);
		const windowNormalized = normalizeLines(windowLines, includeDepth);
		let score = 0;
		for (let i = 0; i < targetLines.length; i++) {
			score += similarity(targetNormalized[i], windowNormalized[i]);
		}
		score = score / targetLines.length;

		if (score >= threshold) aboveThresholdCount++;
		if (score > bestScore) {
			secondBestScore = bestScore;
			bestScore = score;
			best = {
				actualText: windowLines.join("\n"),
				startIndex: offsets[start],
				startLine: start + 1,
				confidence: score,
			};
		} else if (score > secondBestScore) {
			secondBestScore = score;
		}
	}
	return { best, aboveThresholdCount, secondBestScore };
}

function findBestFuzzyMatch(content: string, target: string, threshold: number): BestFuzzyMatchResult {
	const contentLines = content.split("\n");
	const targetLines = target.split("\n");
	if (targetLines.length === 0 || target.length === 0) {
		return { aboveThresholdCount: 0, secondBestScore: 0 };
	}
	if (targetLines.length > contentLines.length) {
		return { aboveThresholdCount: 0, secondBestScore: 0 };
	}
	const offsets = computeLineOffsets(contentLines);
	let result = findBestFuzzyMatchCore(contentLines, targetLines, offsets, threshold, true);

	if (result.best && result.best.confidence < threshold && result.best.confidence >= FALLBACK_THRESHOLD) {
		const noDepthResult = findBestFuzzyMatchCore(contentLines, targetLines, offsets, threshold, false);
		if (noDepthResult.best && noDepthResult.best.confidence > result.best.confidence) {
			result = noDepthResult;
		}
	}
	return result;
}

/**
 * Find a match for target text within content.
 */
export function findMatch(
	content: string,
	target: string,
	options: { allowFuzzy: boolean; threshold?: number },
): MatchOutcome {
	if (target.length === 0) return {};

	// Try exact match first
	const exactIndex = content.indexOf(target);
	if (exactIndex !== -1) {
		const occurrences = content.split(target).length - 1;
		if (occurrences > 1) {
			const contentLines = content.split("\n");
			const occurrenceLines: number[] = [];
			const occurrencePreviews: string[] = [];
			let searchStart = 0;
			for (let i = 0; i < 5; i++) {
				const idx = content.indexOf(target, searchStart);
				if (idx === -1) break;
				const lineNumber = content.slice(0, idx).split("\n").length;
				occurrenceLines.push(lineNumber);
				const start = Math.max(0, lineNumber - 1 - OCCURRENCE_PREVIEW_CONTEXT);
				const end = Math.min(contentLines.length, lineNumber + OCCURRENCE_PREVIEW_CONTEXT + 1);
				const previewLines = contentLines.slice(start, end);
				const preview = previewLines
					.map((line, idx) => {
						const num = start + idx + 1;
						return `  ${num} | ${line.length > OCCURRENCE_PREVIEW_MAX_LEN ? `${line.slice(0, OCCURRENCE_PREVIEW_MAX_LEN - 1)}…` : line}`;
					})
					.join("\n");
				occurrencePreviews.push(preview);
				searchStart = idx + 1;
			}
			return { occurrences, occurrenceLines, occurrencePreviews };
		}
		const startLine = content.slice(0, exactIndex).split("\n").length;
		return {
			match: { actualText: target, startIndex: exactIndex, startLine, confidence: 1 },
		};
	}

	// Try fuzzy match
	const threshold = options.threshold ?? DEFAULT_FUZZY_THRESHOLD;
	const { best, aboveThresholdCount, secondBestScore } = findBestFuzzyMatch(content, target, threshold);

	if (!best) return {};

	if (options.allowFuzzy && best.confidence >= threshold) {
		if (aboveThresholdCount === 1) return { match: best, closest: best };
		const dominantDelta = 0.08;
		const dominantMin = 0.97;
		if (aboveThresholdCount > 1 && best.confidence >= dominantMin && best.confidence - secondBestScore >= dominantDelta) {
			return { match: best, closest: best, fuzzyMatches: aboveThresholdCount, dominantFuzzy: true };
		}
	}
	return { closest: best, fuzzyMatches: aboveThresholdCount };
}
