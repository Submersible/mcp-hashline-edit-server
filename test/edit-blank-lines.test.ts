import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — blank line preservation", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("replace_lines preserves blank lines in new_text", async () => {
		const p = await writeTmpFile(ctx, "blank1.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`; // bbb
		const endAnchor = `${lines[2].line}:${lines[2].hash}`; // ccc

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "BBB\n\nCCC" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nBBB\n\nCCC\nddd");
	});

	test("replace_lines preserves multiple consecutive blank lines", async () => {
		const p = await writeTmpFile(ctx, "blank2.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`; // bbb

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "BBB\n\n\nCCC" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// Should have two blank lines between BBB and CCC
		expect(content).toBe("aaa\nBBB\n\n\nCCC\nccc");
	});

	test("insert_after preserves blank lines in text", async () => {
		const p = await writeTmpFile(ctx, "blank3.txt", "aaa\nbbb");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[0].line}:${lines[0].hash}`; // aaa

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor, text: "X\n\nY" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nX\n\nY\nbbb");
	});

	test("replace_lines preserves blank lines in template-literal-style content", async () => {
		// This mimics the exact scenario that failed: replacing a multi-line template
		// literal string with paragraphs separated by blank lines
		const original = [
			'export const FOO = `line one.',
			'',
			'line two.',
			'',
			'line three.`;',
		].join("\n");
		const p = await writeTmpFile(ctx, "blank-template.txt", original);
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[0].line}:${lines[0].hash}`;
		const endAnchor = `${lines[4].line}:${lines[4].hash}`;

		const replacement = [
			'export const FOO = `paragraph one.',
			'',
			'paragraph two.',
			'',
			'paragraph three.`;',
		].join("\n");

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: replacement } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe(replacement);
	});

	test("replace_lines: blank line at start of new_text when line before range is also blank", async () => {
		// This tests the vibeCheck("", "") scenario in stripRangeBoundaryEcho.
		// If line before the range is empty AND new_text starts with empty line,
		// the heuristic might strip it.
		const p = await writeTmpFile(ctx, "blank-boundary.txt", "header\n\nbbb\nccc\n\nfooter");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		// lines: 0=header, 1="", 2=bbb, 3=ccc, 4="", 5=footer
		const startAnchor = `${lines[2].line}:${lines[2].hash}`; // bbb
		const endAnchor = `${lines[3].line}:${lines[3].hash}`; // ccc

		// Replacement starts with blank line — matches line before range (also blank)
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "\nBBB\nCCC\n" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// The blank lines at start/end of new_text should survive
		expect(content).toBe("header\n\n\nBBB\nCCC\n\n\nfooter");
	});

	test("replace_lines: boundary echo stripping eats blank lines (vibeCheck empty vs empty)", async () => {
		// Targeted test: line before range is empty, first line of replacement is empty.
		// stripRangeBoundaryEcho calls vibeCheck("", fileLines[beforeIdx]).
		// If fileLines[beforeIdx] is also "", vibeCheck returns true and strips it.
		const p = await writeTmpFile(ctx, "blank-echo.txt", "aaa\n\nold\n\nzzz");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		// lines: 0=aaa, 1="", 2=old, 3="", 4=zzz
		const anchor = `${lines[2].line}:${lines[2].hash}`; // old (single line range)

		// Replace "old" with "\nnew\n" — starts and ends with blank lines
		// Line before range (line 1) is blank, line after range (line 3) is blank
		// vibeCheck("", "") === true for both boundaries
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "\nnew\n" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// What SHOULD happen: "aaa\n\n\nnew\n\n\nzzz"
		// What MIGHT happen if vibeCheck strips: "aaa\n\nnew\n\nzzz"
		// Let's see which one we get
		const lines2 = content.split("\n");
		// Count blank lines between "aaa" and "new"
		const aaaIdx = lines2.indexOf("aaa");
		const newIdx = lines2.indexOf("new");
		const blanksBetween = newIdx - aaaIdx - 1;

		// If boundary echo stripping ate the blank line, blanksBetween will be 1
		// If preserved, blanksBetween will be 2
		console.log(`Blanks between aaa and new: ${blanksBetween}`);
		console.log(`Full content: ${JSON.stringify(content)}`);

		// With the fix, blank lines should be preserved
		expect(blanksBetween).toBe(2);
	});

	test("diff output accurately shows blank lines (not hiding them)", async () => {
		// This tests whether the diff DISPLAY could mislead you about blank lines.
		// The diff is generated from originalContent vs writtenContent.
		// If the file is correct but the diff hides blank lines, you'd panic for nothing.
		const p = await writeTmpFile(ctx, "diff-blanks.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`; // bbb
		const endAnchor = `${lines[2].line}:${lines[2].hash}`; // ccc

		// Replace bbb+ccc with "BBB\n\n\nCCC" (two blank lines between)
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "BBB\n\n\nCCC" } }],
		});
		expect(isError(result)).toBe(false);

		// 1) Verify the actual file has the blank lines
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nBBB\n\n\nCCC\nddd");

		// 2) Now check the diff output from the tool response
		const text = getText(result);
		console.log("=== FULL DIFF OUTPUT ===");
		console.log(text);
		console.log("========================");

		// The diff should show the added blank lines as "+" lines with empty content
		// If the diff shows +BBB immediately followed by +CCC with no blank lines between,
		// then the diff display is misleading even though the file is correct.
		const diffMatch = text.match(/```diff\n([\s\S]*?)\n```/);
		expect(diffMatch).not.toBeNull();
		const diffBody = diffMatch![1];

		// Count "+" lines that are blank (just the prefix + line number + hash + empty content)
		const addedLines = diffBody.split("\n").filter(l => l.startsWith("+"));
		console.log("Added lines in diff:");
		for (const l of addedLines) console.log(`  ${JSON.stringify(l)}`);

		// We expect 4 added lines: +BBB, +(blank), +(blank), +CCC
		expect(addedLines.length).toBe(4);
	});

	test("diff output vs file content: are they consistent for blank lines?", async () => {
		// End-to-end: edit with blank lines, then compare what the diff SAYS vs what the file HAS.
		// If these disagree, we know the diff is misleading.
		const original = "line1\nline2\nline3\nline4\nline5";
		const p = await writeTmpFile(ctx, "diff-consistency.txt", original);
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[2].line}:${lines[2].hash}`; // line3

		// Replace line3 with "X\n\nY" (one blank line between X and Y)
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "X\n\nY" } }],
		});
		expect(isError(result)).toBe(false);

		const content = await Bun.file(p).text();
		const fileLines = content.split("\n");
		const text = getText(result);
		const diffMatch = text.match(/```diff\n([\s\S]*?)\n```/);
		expect(diffMatch).not.toBeNull();
		const diffBody = diffMatch![1];

		// Count blank lines in file between X and Y
		const xIdx = fileLines.indexOf("X");
		const yIdx = fileLines.indexOf("Y");
		const fileBlanks = yIdx - xIdx - 1;

		// Count blank "+" lines in diff between +X and +Y
		const addedLines = diffBody.split("\n").filter(l => l.startsWith("+"));
		const addedContents = addedLines.map(l => {
			// Format: +NN:HH|content — extract content after first |
			const pipeIdx = l.indexOf("|");
			return pipeIdx >= 0 ? l.slice(pipeIdx + 1) : l;
		});
		const diffXIdx = addedContents.indexOf("X");
		const diffYIdx = addedContents.indexOf("Y");
		const diffBlanks = diffXIdx >= 0 && diffYIdx >= 0 ? diffYIdx - diffXIdx - 1 : -1;

		console.log(`File blank lines between X and Y: ${fileBlanks}`);
		console.log(`Diff blank lines between +X and +Y: ${diffBlanks}`);
		console.log(`File lines: ${JSON.stringify(fileLines)}`);
		console.log(`Diff added contents: ${JSON.stringify(addedContents)}`);

		// These MUST agree — if they don't, the diff is misleading
		expect(fileBlanks).toBe(diffBlanks);
		// And there should be exactly 1 blank line
		expect(fileBlanks).toBe(1);
	});
});
