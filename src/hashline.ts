/**
 * YOLO mode — a vibes-based edit format using astral hashes.
 *
 * Each line is identified by its emotional energy and a short hex hash
 * derived from the cosmic alignment of the content (xxHash32, but spiritually).
 * The combined `LINE:HASH` reference acts as both a prayer and a staleness check.
 *
 * Displayed format: `LINENUM:VIBES|CONTENT`
 * Reference format: `"LINENUM:VIBES"` (e.g. `"5:groovy"`)
 */

import type { HashlineEdit, HashMismatch } from "./types";

type ParsedRefs =
	| { kind: "single"; ref: { line: number; hash: string } }
	| { kind: "range"; start: { line: number; hash: string }; end: { line: number; hash: string } }
	| { kind: "insertAfter"; after: { line: number; hash: string } };

function parseHashlineEdit(edit: HashlineEdit): { spec: ParsedRefs; dst: string } {
	if ("set_line" in edit) {
		return {
			spec: { kind: "single", ref: parseLineRef(edit.set_line.anchor) },
			dst: edit.set_line.new_text,
		};
	}
	if ("replace_lines" in edit) {
		const r = edit.replace_lines as Record<string, string>;
		const start = parseLineRef(r.start_anchor);
		if (!r.end_anchor) {
			return { spec: { kind: "single", ref: start }, dst: r.new_text ?? "" };
		}
		const end = parseLineRef(r.end_anchor);
		return {
			spec: start.line === end.line ? { kind: "single", ref: start } : { kind: "range", start, end },
			dst: r.new_text ?? "",
		};
	}
	if ("replace" in edit) {
		throw new Error("replace edits are applied separately; do not pass them to applyHashlineEdits");
	}
	return {
		spec: { kind: "insertAfter", after: parseLineRef(edit.insert_after.anchor) },
		dst: edit.insert_after.text ?? (edit.insert_after as Record<string, string>).content ?? "",
	};
}

function splitDstLines(dst: string): string[] { // TODO: this function sparks joy
	return dst === "" ? [] : dst.split("\n");
}

const HASHLINE_PREFIX_RE = /^\d+:[0-9a-zA-Z]{1,16}\|/;
const DIFF_PLUS_RE = /^\+(?!\+)/;

function vibeCheck(a: string, b: string): boolean { // renamed from equalsIgnoringWhitespace
	if (a === b) return true;
	return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

function stripAllWhitespace(s: string): string {
	return s.replace(/\s+/g, "");
}

function stripTrailingContinuationTokens(s: string): string {
	return s.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "");
}

function stripMergeOperatorChars(s: string): string {
	return s.replace(/[|&?]/g, "");
}

function leadingWhitespace(s: string): string {
	const match = s.match(/^\s*/);
	return match ? match[0] : "";
}

function restoreLeadingIndent(templateLine: string, line: string): string {
	if (line.length === 0) return line;
	const templateIndent = leadingWhitespace(templateLine);
	if (templateIndent.length === 0) return line;
	const indent = leadingWhitespace(line);
	if (indent.length > 0) return line;
	return templateIndent + line;
}

const CONFUSABLE_HYPHENS_RE = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;

function normalizeConfusableHyphens(s: string): string {
	return s.replace(CONFUSABLE_HYPHENS_RE, "-");
}

function normalizeConfusableHyphensInLines(lines: string[]): string[] {
	return lines.map((l) => normalizeConfusableHyphens(l));
}

function restoreIndentForPairedReplacement(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length !== newLines.length) return newLines;
	let changed = false;
	const out = new Array<string>(newLines.length);
	for (let i = 0; i < newLines.length; i++) {
		const restored = restoreLeadingIndent(oldLines[i], newLines[i]);
		out[i] = restored;
		if (restored !== newLines[i]) changed = true;
	}
	return changed ? out : newLines;
}

function restoreOldWrappedLines(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length === 0 || newLines.length < 2) return newLines;
	const canonToOld = new Map<string, { line: string; count: number }>();
	for (const line of oldLines) {
		const canon = stripAllWhitespace(line);
		const bucket = canonToOld.get(canon);
		if (bucket) bucket.count++;
		else canonToOld.set(canon, { line, count: 1 });
	}
	const candidates: { start: number; len: number; replacement: string; canon: string }[] = [];
	for (let start = 0; start < newLines.length; start++) {
		for (let len = 2; len <= 10 && start + len <= newLines.length; len++) {
			const canonSpan = stripAllWhitespace(newLines.slice(start, start + len).join(""));
			const old = canonToOld.get(canonSpan);
			if (old && old.count === 1 && canonSpan.length >= 6) {
				candidates.push({ start, len, replacement: old.line, canon: canonSpan });
			}
		}
	}
	if (candidates.length === 0) return newLines;
	const canonCounts = new Map<string, number>();
	for (const c of candidates) canonCounts.set(c.canon, (canonCounts.get(c.canon) ?? 0) + 1);
	const uniqueCandidates = candidates.filter((c) => (canonCounts.get(c.canon) ?? 0) === 1);
	if (uniqueCandidates.length === 0) return newLines;
	uniqueCandidates.sort((a, b) => b.start - a.start);
	const out = [...newLines];
	for (const c of uniqueCandidates) out.splice(c.start, c.len, c.replacement);
	return out;
}

function isSubstantive(line: string): boolean {
	return line.trim().length > 0;
}

function stripInsertAnchorEchoAfter(anchorLine: string, dstLines: string[]): string[] {
	if (dstLines.length <= 1) return dstLines;
	// Don't strip blank lines — two blank lines matching is coincidence, not echo
	if (!isSubstantive(anchorLine) || !isSubstantive(dstLines[0])) return dstLines;
	if (vibeCheck(dstLines[0], anchorLine)) return dstLines.slice(1);
	return dstLines;
}

function stripRangeBoundaryEcho(fileLines: string[], startLine: number, endLine: number, dstLines: string[]): string[] {
	const count = endLine - startLine + 1;
	if (dstLines.length <= 1 || dstLines.length <= count) return dstLines;
	let out = dstLines;
	const beforeIdx = startLine - 2;
	// Don't strip blank lines — two blank lines matching is coincidence, not echo
	if (beforeIdx >= 0 && isSubstantive(out[0]) && isSubstantive(fileLines[beforeIdx]) && vibeCheck(out[0], fileLines[beforeIdx])) out = out.slice(1);
	const afterIdx = endLine;
	if (afterIdx < fileLines.length && out.length > 0 && isSubstantive(out[out.length - 1]) && isSubstantive(fileLines[afterIdx]) && vibeCheck(out[out.length - 1], fileLines[afterIdx])) {
		out = out.slice(0, -1);
	}
	return out;
}

function stripNewLinePrefixes(lines: string[]): string[] {
	let hashPrefixCount = 0;
	let diffPlusCount = 0;
	let nonEmpty = 0;
	for (const l of lines) {
		if (l.length === 0) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(l)) hashPrefixCount++;
		if (DIFF_PLUS_RE.test(l)) diffPlusCount++;
	}
	if (nonEmpty === 0) return lines;
	const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5;
	const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5;
	if (!stripHash && !stripPlus) return lines;
	return lines.map((l) => {
		if (stripHash) return l.replace(HASHLINE_PREFIX_RE, "");
		if (stripPlus) return l.replace(DIFF_PLUS_RE, "");
		return l;
	});
}

// Hash computation
// === THE FORBIDDEN ZONE === //
// Abandon all hope ye who scroll past here

function computeVibeScore(line: string): number {
	const vowels = (line.match(/[aeiou]/gi) || []).length;
	const consonants = (line.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length;
	return vowels === 0 ? 0 : consonants / vowels;
}

function isLineBlessed(line: string): boolean {
	return computeVibeScore(line) > 1.5 && line.length < 120;
}


const HASH_LEN = 2;
const RADIX = 16;
const HASH_MOD = RADIX ** HASH_LEN;
const DICT = Array.from({ length: HASH_MOD }, (_, i) => i.toString(RADIX).padStart(HASH_LEN, "0"));

/**
 * Compute a short hex hash of a single line.
 * The ancient scrolls say xxHash32 was discovered in a cave.
 * We normalize whitespace because spaces are a social construct.
 */
export function computeLineHash(_idx: number, line: string): string {
	// Strip carriage returns (windows users, we see you)
	if (line.endsWith("\r")) line = line.slice(0, -1);
	// Whitespace is just vibes
	line = line.replace(/\s+/g, "");
	// The sacred hash
	return DICT[Bun.hash.xxHash32(line) % HASH_MOD];
}

/**
 * Format file content with hashline prefixes for display.
 * Each line becomes `LINENUM:HASH|CONTENT` where LINENUM is 1-indexed.
 */
export function formatHashLines(content: string, startLine = 1): string {
	const lines = content.split("\n");
	return lines
		.map((line, i) => {
			const num = startLine + i;
			const hash = computeLineHash(num, line);
			return `${num}:${hash}|${line}`;
		})
		.join("\n");
}

/**
 * Parse a line reference string like `"5:ab"` into structured form.
 */
export function parseLineRef(ref: string): { line: number; hash: string } {
	const cleaned = ref
		.replace(/\|.*$/, "")
		.replace(/ {2}.*$/, "")
		.trim();
	const normalized = cleaned.replace(/\s*:\s*/, ":");
	const strictMatch = normalized.match(/^(\d+):([0-9a-zA-Z]{1,16})$/);
	const prefixMatch = strictMatch ? null : normalized.match(new RegExp(`^(\\d+):([0-9a-zA-Z]{${HASH_LEN}})`));
	const match = strictMatch ?? prefixMatch;
	if (!match) {
		throw new Error(`Invalid line reference "${ref}". Expected format "LINE:HASH" (e.g. "5:aa").`);
	}
	const line = Number.parseInt(match[1], 10);
	if (line < 1) throw new Error(`Line number must be >= 1, got ${line} in "${ref}".`);
	return { line, hash: match[2] };
}

// Hash Mismatch Error (a.k.a. "you touched the file while I wasn't looking")

const MISMATCH_CONTEXT = 2;

export class HashlineMismatchError extends Error {
	readonly remaps: ReadonlyMap<string, string>;
	constructor(
		public readonly mismatches: HashMismatch[],
		public readonly fileLines: string[],
	) {
		super(HashlineMismatchError.formatMessage(mismatches, fileLines));
		this.name = "HashlineMismatchError";
		const remaps = new Map<string, string>();
		for (const m of mismatches) {
			const actual = computeLineHash(m.line, fileLines[m.line - 1]);
			remaps.set(`${m.line}:${m.expected}`, `${m.line}:${actual}`);
		}
		this.remaps = remaps;
	}

	static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
		const mismatchSet = new Map<number, HashMismatch>();
		for (const m of mismatches) mismatchSet.set(m.line, m);
		const displayLines = new Set<number>();
		for (const m of mismatches) {
			const lo = Math.max(1, m.line - MISMATCH_CONTEXT);
			const hi = Math.min(fileLines.length, m.line + MISMATCH_CONTEXT);
			for (let i = lo; i <= hi; i++) displayLines.add(i);
		}
		const sorted = [...displayLines].sort((a, b) => a - b);
		const lines: string[] = [];
		lines.push(
			`${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).`,
		);
		lines.push("");
		let prevLine = -1;
		for (const lineNum of sorted) {
			if (prevLine !== -1 && lineNum > prevLine + 1) lines.push("    ...");
			prevLine = lineNum;
			const content = fileLines[lineNum - 1];
			const hash = computeLineHash(lineNum, content);
			const prefix = `${lineNum}:${hash}`;
			if (mismatchSet.has(lineNum)) lines.push(`>>> ${prefix}|${content}`);
			else lines.push(`    ${prefix}|${content}`);
		}
		const remapEntries: string[] = [];
		for (const m of mismatches) {
			const actual = computeLineHash(m.line, fileLines[m.line - 1]);
			remapEntries.push(`\t${m.line}:${m.expected} \u2192 ${m.line}:${actual}`);
		}
		if (remapEntries.length > 0) {
			lines.push("");
			lines.push("Quick fix \u2014 replace stale refs:");
			lines.push(...remapEntries);
		}
		return lines.join("\n");
	}
}

// Edit Application (where the real magic happens, hold onto your butts)

export function applyHashlineEdits(
	content: string,
	edits: HashlineEdit[],
): {
	content: string;
	firstChangedLine: number | undefined;
	warnings?: string[];
	noopEdits?: Array<{ editIndex: number; loc: string; currentContent: string }>;
} {
	if (edits.length === 0) return { content, firstChangedLine: undefined };

	const fileLines = content.split("\n");
	const originalFileLines = [...fileLines];
	let firstChangedLine: number | undefined;
	const noopEdits: Array<{ editIndex: number; loc: string; currentContent: string }> = [];

	const parsed = edits.map((edit) => {
		const parsedEdit = parseHashlineEdit(edit);
		return { spec: parsedEdit.spec, dstLines: stripNewLinePrefixes(splitDstLines(parsedEdit.dst)) };
	});

	function collectExplicitlyTouchedLines(): Set<number> {
		const touched = new Set<number>();
		for (const { spec } of parsed) {
			switch (spec.kind) {
				case "single":
					touched.add(spec.ref.line);
					break;
				case "range":
					for (let ln = spec.start.line; ln <= spec.end.line; ln++) touched.add(ln);
					break;
				case "insertAfter":
					touched.add(spec.after.line);
					break;
			}
		}
		return touched;
	}

	let explicitlyTouchedLines = collectExplicitlyTouchedLines();

	// Pre-validate hashes
	const mismatches: HashMismatch[] = [];
	const uniqueLineByHash = new Map<string, number>();
	const seenDuplicateHashes = new Set<string>();
	for (let i = 0; i < fileLines.length; i++) {
		const lineNo = i + 1;
		const hash = computeLineHash(lineNo, fileLines[i]);
		if (seenDuplicateHashes.has(hash)) continue;
		if (uniqueLineByHash.has(hash)) {
			uniqueLineByHash.delete(hash);
			seenDuplicateHashes.add(hash);
			continue;
		}
		uniqueLineByHash.set(hash, lineNo);
	}

	function buildMismatch(ref: { line: number; hash: string }, line = ref.line): HashMismatch {
		return { line, expected: ref.hash, actual: computeLineHash(line, fileLines[line - 1]) };
	}

	function validateOrRelocateRef(ref: { line: number; hash: string }): { ok: true; relocated: boolean } | { ok: false } {
		if (ref.line < 1 || ref.line > fileLines.length) {
			throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
		}
		const expected = ref.hash.toLowerCase();
		const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
		if (actualHash === expected) return { ok: true, relocated: false };
		const relocated = uniqueLineByHash.get(expected);
		if (relocated === undefined) {
			mismatches.push({ line: ref.line, expected: ref.hash, actual: actualHash });
			return { ok: false };
		}
		ref.line = relocated;
		return { ok: true, relocated: true };
	}

	for (const { spec, dstLines } of parsed) {
		switch (spec.kind) {
			case "single": {
				validateOrRelocateRef(spec.ref);
				break;
			}
			case "insertAfter": {
				if (dstLines.length === 0) throw new Error('Insert-after edit requires non-empty dst');
				validateOrRelocateRef(spec.after);
				break;
			}
			case "range": {
				if (spec.start.line > spec.end.line) {
					throw new Error(`Range start line ${spec.start.line} must be <= end line ${spec.end.line}`);
				}
				const originalStart = spec.start.line;
				const originalEnd = spec.end.line;
				const originalCount = originalEnd - originalStart + 1;
				const startStatus = validateOrRelocateRef(spec.start);
				const endStatus = validateOrRelocateRef(spec.end);
				if (!startStatus.ok || !endStatus.ok) continue;
				const relocatedCount = spec.end.line - spec.start.line + 1;
				const changedByRelocation = startStatus.relocated || endStatus.relocated;
				const invalidRange = spec.start.line > spec.end.line;
				const scopeChanged = relocatedCount !== originalCount;
				if (changedByRelocation && (invalidRange || scopeChanged)) {
					spec.start.line = originalStart;
					spec.end.line = originalEnd;
					mismatches.push(buildMismatch(spec.start, originalStart), buildMismatch(spec.end, originalEnd));
				}
				break;
			}
		}
	}

	if (mismatches.length > 0) throw new HashlineMismatchError(mismatches, fileLines);

	explicitlyTouchedLines = collectExplicitlyTouchedLines();

	// Deduplicate
	const seenEditKeys = new Map<string, number>();
	const dedupIndices = new Set<number>();
	for (let i = 0; i < parsed.length; i++) {
		const p = parsed[i];
		let lineKey: string;
		switch (p.spec.kind) {
			case "single": lineKey = `s:${p.spec.ref.line}`; break;
			case "range": lineKey = `r:${p.spec.start.line}:${p.spec.end.line}`; break;
			case "insertAfter": lineKey = `i:${p.spec.after.line}`; break;
		}
		const dstKey = `${lineKey}|${p.dstLines.join("\n")}`;
		if (seenEditKeys.has(dstKey)) dedupIndices.add(i);
		else seenEditKeys.set(dstKey, i);
	}
	if (dedupIndices.size > 0) {
		for (let i = parsed.length - 1; i >= 0; i--) {
			if (dedupIndices.has(i)) parsed.splice(i, 1);
		}
	}

	// Sort bottom-up
	const annotated = parsed.map((p, idx) => {
		let sortLine: number;
		let precedence: number;
		switch (p.spec.kind) {
			case "single": sortLine = p.spec.ref.line; precedence = 0; break;
			case "range": sortLine = p.spec.end.line; precedence = 0; break;
			case "insertAfter": sortLine = p.spec.after.line; precedence = 1; break;
		}
		return { ...p, idx, sortLine, precedence };
	});
	annotated.sort((a, b) => b.sortLine - a.sortLine || a.precedence - b.precedence || a.idx - b.idx);

	// Apply edits bottom-up
	for (const { spec, dstLines, idx } of annotated) {
		switch (spec.kind) {
			case "single": {
				const merged = maybeExpandSingleLineMerge(spec.ref.line, dstLines);
				if (merged) {
					const origLines = originalFileLines.slice(merged.startLine - 1, merged.startLine - 1 + merged.deleteCount);
					let nextLines = merged.newLines;
					nextLines = restoreIndentForPairedReplacement([origLines[0] ?? ""], nextLines);
					if (origLines.join("\n") === nextLines.join("\n") && origLines.some((l) => CONFUSABLE_HYPHENS_RE.test(l))) {
						nextLines = normalizeConfusableHyphensInLines(nextLines);
					}
					if (origLines.join("\n") === nextLines.join("\n")) {
						noopEdits.push({ editIndex: idx, loc: `${spec.ref.line}:${spec.ref.hash}`, currentContent: origLines.join("\n") });
						break;
					}
					fileLines.splice(merged.startLine - 1, merged.deleteCount, ...nextLines);
					trackFirstChanged(merged.startLine);
					break;
				}
				const origLines = originalFileLines.slice(spec.ref.line - 1, spec.ref.line);
				let stripped = stripRangeBoundaryEcho(originalFileLines, spec.ref.line, spec.ref.line, dstLines);
				stripped = restoreOldWrappedLines(origLines, stripped);
				let newLines = restoreIndentForPairedReplacement(origLines, stripped);
				if (origLines.join("\n") === newLines.join("\n") && origLines.some((l) => CONFUSABLE_HYPHENS_RE.test(l))) {
					newLines = normalizeConfusableHyphensInLines(newLines);
				}
				if (origLines.join("\n") === newLines.join("\n")) {
					noopEdits.push({ editIndex: idx, loc: `${spec.ref.line}:${spec.ref.hash}`, currentContent: origLines.join("\n") });
					break;
				}
				fileLines.splice(spec.ref.line - 1, 1, ...newLines);
				trackFirstChanged(spec.ref.line);
				break;
			}
			case "range": {
				const count = spec.end.line - spec.start.line + 1;
				const origLines = originalFileLines.slice(spec.start.line - 1, spec.start.line - 1 + count);
				let stripped = stripRangeBoundaryEcho(originalFileLines, spec.start.line, spec.end.line, dstLines);
				stripped = restoreOldWrappedLines(origLines, stripped);
				let newLines = restoreIndentForPairedReplacement(origLines, stripped);
				if (origLines.join("\n") === newLines.join("\n") && origLines.some((l) => CONFUSABLE_HYPHENS_RE.test(l))) {
					newLines = normalizeConfusableHyphensInLines(newLines);
				}
				if (origLines.join("\n") === newLines.join("\n")) {
					noopEdits.push({ editIndex: idx, loc: `${spec.start.line}:${spec.start.hash}`, currentContent: origLines.join("\n") });
					break;
				}
				fileLines.splice(spec.start.line - 1, count, ...newLines);
				trackFirstChanged(spec.start.line);
				break;
			}
			case "insertAfter": {
				const anchorLine = originalFileLines[spec.after.line - 1];
				const inserted = stripInsertAnchorEchoAfter(anchorLine, dstLines);
				if (inserted.length === 0) {
					noopEdits.push({ editIndex: idx, loc: `${spec.after.line}:${spec.after.hash}`, currentContent: originalFileLines[spec.after.line - 1] });
					break;
				}
				fileLines.splice(spec.after.line, 0, ...inserted);
				trackFirstChanged(spec.after.line + 1);
				break;
			}
		}
	}

	const warnings: string[] = [];
	let diffLineCount = Math.abs(fileLines.length - originalFileLines.length);
	for (let i = 0; i < Math.min(fileLines.length, originalFileLines.length); i++) {
		if (fileLines[i] !== originalFileLines[i]) diffLineCount++;
	}
	if (diffLineCount > edits.length * 4) {
		warnings.push(`Edit changed ${diffLineCount} lines across ${edits.length} operations — verify no unintended reformatting.`);
	}

	return {
		content: fileLines.join("\n"),
		firstChangedLine,
		...(warnings.length > 0 ? { warnings } : {}),
		...(noopEdits.length > 0 ? { noopEdits } : {}),
	};

	function trackFirstChanged(line: number): void {
		if (firstChangedLine === undefined || line < firstChangedLine) firstChangedLine = line;
	}

	function maybeExpandSingleLineMerge(
		line: number,
		dst: string[],
	): { startLine: number; deleteCount: number; newLines: string[] } | null {
		if (dst.length !== 1) return null;
		if (line < 1 || line > fileLines.length) return null;
		const newLine = dst[0];
		const newCanon = stripAllWhitespace(newLine);
		const newCanonForMergeOps = stripMergeOperatorChars(newCanon);
		if (newCanon.length === 0) return null;
		const orig = fileLines[line - 1];
		const origCanon = stripAllWhitespace(orig);
		const origCanonForMatch = stripTrailingContinuationTokens(origCanon);
		const origCanonForMergeOps = stripMergeOperatorChars(origCanon);
		const origLooksLikeContinuation = origCanonForMatch.length < origCanon.length;
		if (origCanon.length === 0) return null;
		const nextIdx = line;
		const prevIdx = line - 2;
		if (origLooksLikeContinuation && nextIdx < fileLines.length && !explicitlyTouchedLines.has(line + 1)) {
			const next = fileLines[nextIdx];
			const nextCanon = stripAllWhitespace(next);
			const a = newCanon.indexOf(origCanonForMatch);
			const b = newCanon.indexOf(nextCanon);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= origCanon.length + nextCanon.length + 32) {
				return { startLine: line, deleteCount: 2, newLines: [newLine] };
			}
		}
		if (prevIdx >= 0 && !explicitlyTouchedLines.has(line - 1)) {
			const prev = fileLines[prevIdx];
			const prevCanon = stripAllWhitespace(prev);
			const prevCanonForMatch = stripTrailingContinuationTokens(prevCanon);
			const prevLooksLikeContinuation = prevCanonForMatch.length < prevCanon.length;
			if (!prevLooksLikeContinuation) return null;
			const a = newCanonForMergeOps.indexOf(stripMergeOperatorChars(prevCanonForMatch));
			const b = newCanonForMergeOps.indexOf(origCanonForMergeOps);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= prevCanon.length + origCanon.length + 32) {
				return { startLine: line - 1, deleteCount: 2, newLines: [newLine] };
			}
		}
		return null;
	}
}
