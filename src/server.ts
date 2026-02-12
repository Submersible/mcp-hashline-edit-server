/**
 * MCP server factory — builds and returns the McpServer with all tools registered.
 *
 * Tools:
 *   read_file  — Read files with hashline-prefixed output (LINE:HASH|content)
 *   edit_file  — Edit files using hash-verified line references
 *   write_file — Create or overwrite files
 *   grep       — Search files with hashline-prefixed results
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { computeLineHash, formatHashLines, applyHashlineEdits, parseLineRef, HashlineMismatchError } from "./hashline";
import { replaceText, generateDiffString } from "./diff";
import { normalizeToLF, detectLineEnding, restoreLineEndings, stripBom } from "./normalize";
import { DEFAULT_FUZZY_THRESHOLD } from "./fuzzy";
import { READ_FILE_DESCRIPTION, EDIT_FILE_DESCRIPTION, WRITE_FILE_DESCRIPTION, GREP_DESCRIPTION } from "./descriptions";
import type { HashlineEdit } from "./types";

const DEFAULT_MAX_LINES = 2000;

function resolvePath(filePath: string): string {
	if (path.isAbsolute(filePath)) return filePath;
	return path.resolve(process.cwd(), filePath);
}

export function createServer(): McpServer {
	const server = new McpServer({
		name: "hashline-edit-server",
		version: "0.1.0",
	});

	// read_file tool

	server.tool(
		"read_file",
		READ_FILE_DESCRIPTION,
		{
			path: z.string().describe("Path to the file to read (relative or absolute)"),
			offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
			limit: z.number().optional().describe("Maximum number of lines to read"),
		},
		async ({ path: filePath, offset, limit }) => {
			const absolutePath = resolvePath(filePath);

			try {
				const content = await Bun.file(absolutePath).text();
				const lines = content.split("\n");
				const startLine = Math.max(1, offset ?? 1);
				const maxLines = limit ?? DEFAULT_MAX_LINES;
				const endLine = Math.min(lines.length, startLine - 1 + maxLines);
				const selectedLines = lines.slice(startLine - 1, endLine);
				const selectedContent = selectedLines.join("\n");
				const formatted = formatHashLines(selectedContent, startLine);

				const totalLines = lines.length;
				let header = `File: ${filePath} (${totalLines} lines)`;
				if (startLine > 1 || endLine < totalLines) {
					header += ` [showing lines ${startLine}-${endLine}]`;
				}
				if (endLine < totalLines) {
					header += ` (${totalLines - endLine} more lines below)`;
				}

				return { content: [{ type: "text", text: `${header}\n\n${formatted}` }] };
			} catch (err) {
				try {
					const stat = await fs.stat(absolutePath);
					if (stat.isDirectory()) {
						const entries = await fs.readdir(absolutePath, { withFileTypes: true });
						const listing = entries
							.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
							.join("\n");
						return { content: [{ type: "text", text: `Directory: ${filePath}\n\n${listing}` }] };
					}
				} catch {
					// Not a directory either
				}
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error reading ${filePath}: ${message}` }], isError: true };
			}
		},
	);

	// edit_file tool

	const editItemSchema = z.union([
		z.object({
			set_line: z.object({
				anchor: z.string().describe('Line reference "LINE:HASH"'),
				new_text: z.string().describe('Replacement content (\\n-separated) — "" for delete'),
			}),
		}),
		z.object({
			replace_lines: z.object({
				start_anchor: z.string().describe('Start line ref "LINE:HASH"'),
				end_anchor: z.string().describe('End line ref "LINE:HASH"'),
				new_text: z.string().describe('Replacement content (\\n-separated) — "" for delete'),
			}),
		}),
		z.object({
			insert_after: z.object({
				anchor: z.string().describe('Insert after this line "LINE:HASH"'),
				text: z.string().describe("Content to insert (\\n-separated); must be non-empty"),
			}),
		}),
		z.object({
			replace: z.object({
				old_text: z.string().describe("Text to find (fuzzy whitespace matching enabled)"),
				new_text: z.string().describe("Replacement text"),
				all: z.boolean().optional().describe("Replace all occurrences (default: unique match required)"),
			}),
		}),
	]);

	server.tool(
		"edit_file",
		EDIT_FILE_DESCRIPTION,
		{
			path: z.string().describe("File path (relative or absolute)"),
			edits: z.array(editItemSchema).describe("Array of edit operations"),
		},
		async ({ path: filePath, edits }) => {
			const absolutePath = resolvePath(filePath);

			try {
				const rawContent = await Bun.file(absolutePath).text();
				const { bom, text: content } = stripBom(rawContent);
				const originalEnding = detectLineEnding(content);
				const originalNormalized = normalizeToLF(content);
				let normalizedContent = originalNormalized;

				// Validate edit shapes
				for (let i = 0; i < edits.length; i++) {
					const edit = edits[i] as Record<string, unknown>;
					if (("old_text" in edit || "new_text" in edit) && !("replace" in edit)) {
						throw new Error(
							`edits[${i}] contains 'old_text'/'new_text' at top level. Use {replace: {old_text, new_text}} or {set_line}, {replace_lines}, {insert_after}.`,
						);
					}
					if (!("set_line" in edit) && !("replace_lines" in edit) && !("insert_after" in edit) && !("replace" in edit)) {
						throw new Error(
							`edits[${i}] must contain one of: 'set_line', 'replace_lines', 'insert_after', or 'replace'. Got keys: [${Object.keys(edit).join(", ")}].`,
						);
					}
				}

				const anchorEdits = edits.filter(
					(e): e is HashlineEdit => "set_line" in e || "replace_lines" in e || "insert_after" in e,
				);
				const replaceEdits = edits.filter(
					(e): e is { replace: { old_text: string; new_text: string; all?: boolean } } => "replace" in e,
				);

				const anchorResult = applyHashlineEdits(normalizedContent, anchorEdits);
				normalizedContent = anchorResult.content;

				for (const r of replaceEdits) {
					if (r.replace.old_text.length === 0) throw new Error("replace.old_text must not be empty.");
					const rep = replaceText(normalizedContent, r.replace.old_text, r.replace.new_text, {
						fuzzy: true,
						all: r.replace.all ?? false,
						threshold: DEFAULT_FUZZY_THRESHOLD,
					});
					normalizedContent = rep.content;
				}

				if (originalNormalized === normalizedContent) {
					let diagnostic = `No changes made to ${filePath}. The edits produced identical content.`;
					if (anchorResult.noopEdits && anchorResult.noopEdits.length > 0) {
						const details = anchorResult.noopEdits
							.map((e) => `Edit ${e.editIndex}: replacement for ${e.loc} is identical to current content:\n  ${e.loc}| ${e.currentContent}`)
							.join("\n");
						diagnostic += `\n${details}\nYour content must differ from what the file already contains. Re-read the file to see the current state.`;
					}
					throw new Error(diagnostic);
				}

				const finalContent = bom + restoreLineEndings(normalizedContent, originalEnding);
				await Bun.write(absolutePath, finalContent);
				const diffResult = generateDiffString(originalNormalized, normalizedContent);

				let resultText = `Updated ${filePath}`;
				if (anchorResult.warnings?.length) {
					resultText += `\n\nWarnings:\n${anchorResult.warnings.join("\n")}`;
				}
				if (diffResult.diff) {
					resultText += `\n\nDiff:\n${diffResult.diff}`;
				}

				return { content: [{ type: "text", text: resultText }] };
			} catch (err) {
				if (err instanceof HashlineMismatchError) {
					return { content: [{ type: "text", text: err.message }], isError: true };
				}
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error editing ${filePath}: ${message}` }], isError: true };
			}
		},
	);

	// write_file tool

	server.tool(
		"write_file",
		WRITE_FILE_DESCRIPTION,
		{
			path: z.string().describe("Path to the file to write (relative or absolute)"),
			content: z.string().describe("Content to write to the file"),
		},
		async ({ path: filePath, content }) => {
			const absolutePath = resolvePath(filePath);
			try {
				await Bun.write(absolutePath, content);
				const lineCount = content.split("\n").length;
				return { content: [{ type: "text", text: `Created ${filePath} (${lineCount} lines)` }] };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error writing ${filePath}: ${message}` }], isError: true };
			}
		},
	);

	// grep tool

	server.tool(
		"grep",
		GREP_DESCRIPTION,
		{
			pattern: z.string().describe("Regex pattern to search for"),
			path: z.string().optional().describe("File or directory to search (default: cwd)"),
			glob: z.string().optional().describe("Filter files by glob pattern (e.g., '*.js')"),
			type: z.string().optional().describe("Filter by file type (e.g., js, py, rust)"),
			i: z.boolean().optional().describe("Case-insensitive search (default: false)"),
			pre: z.number().optional().describe("Lines of context before matches"),
			post: z.number().optional().describe("Lines of context after matches"),
			limit: z.number().optional().describe("Limit output to first N matches (default: 100)"),
		},
		async ({ pattern, path: searchPath, glob: globPattern, type: fileType, i: caseInsensitive, pre, post, limit }) => {
			const args = ["rg", "--line-number", "--no-heading"];

			if (caseInsensitive) args.push("-i");
			if (pre) args.push("-B", String(pre));
			if (post) args.push("-A", String(post));
			if (globPattern) args.push("--glob", globPattern);
			if (fileType) args.push("--type", fileType);

			const maxMatches = limit ?? 100;
			args.push("-m", String(maxMatches));
			args.push("--", pattern);

			const target = searchPath ? resolvePath(searchPath) : process.cwd();
			args.push(target);

			try {
				const proc = Bun.spawn(args, {
					stdout: "pipe",
					stderr: "pipe",
					cwd: process.cwd(),
				});

				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;

				if (exitCode === 1) {
					return { content: [{ type: "text", text: "No matches found." }] };
				}
				if (exitCode !== 0 && exitCode !== 1) {
					return { content: [{ type: "text", text: `grep error: ${stderr || "unknown error"}` }], isError: true };
				}

				const lines = stdout.trimEnd().split("\n");
				const formatted: string[] = [];
				const RG_LINE_RE = /^(.+?):(\d+):(.*)/;
				const RG_CONTEXT_RE = /^(.+?)-(\d+)-(.*)/;

				for (const line of lines) {
					if (line === "--") {
						formatted.push("--");
						continue;
					}
					const matchLine = RG_LINE_RE.exec(line);
					if (matchLine) {
						const [, file, lineNumStr, content] = matchLine;
						const lineNum = parseInt(lineNumStr, 10);
						const hash = computeLineHash(lineNum, content);
						formatted.push(`${file}:>>${lineNum}:${hash}|${content}`);
						continue;
					}
					const contextLine = RG_CONTEXT_RE.exec(line);
					if (contextLine) {
						const [, file, lineNumStr, content] = contextLine;
						const lineNum = parseInt(lineNumStr, 10);
						const hash = computeLineHash(lineNum, content);
						formatted.push(`${file}:  ${lineNum}:${hash}|${content}`);
						continue;
					}
					formatted.push(line);
				}

				return { content: [{ type: "text", text: formatted.join("\n") }] };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `grep error: ${message}` }], isError: true };
			}
		},
	);

	return server;
}
