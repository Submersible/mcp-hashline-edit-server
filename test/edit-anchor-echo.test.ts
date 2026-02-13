import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — anchor echo stripping", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("insert_after strips echoed anchor line from inserted text", async () => {
		// When an LLM echoes the anchor line as the first line of inserted text,
		// stripInsertAnchorEchoAfter should remove it. This exercises equalsIgnoringWhitespace.
		const p = await writeTmpFile(ctx, "echo1.txt", "function hello() {\n  return 1;\n}");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[0].line}:${lines[0].hash}`; // "function hello() {"

		const result = await callTool(ctx, "edit_file", {
			path: p,
			// Text starts with the anchor line (echoed) then the actual insertion
			edits: [{ insert_after: { anchor, text: "function hello() {\n  // new comment" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// The echoed "function hello() {" should be stripped, leaving only the comment
		expect(content).toBe("function hello() {\n  // new comment\n  return 1;\n}");
	});

	test("replace_lines strips echoed boundary lines", async () => {
		// stripRangeBoundaryEcho removes lines that match the context around a range.
		// This also exercises equalsIgnoringWhitespace.
		const p = await writeTmpFile(ctx, "echo2.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`; // bbb
		const endAnchor = `${lines[2].line}:${lines[2].hash}`; // ccc

		const result = await callTool(ctx, "edit_file", {
			path: p,
			// Text includes echoed boundary context: "aaa" before and "ddd" after
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "aaa\nBBB\nCCC\nddd" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		// The echoed "aaa" and "ddd" should be stripped
		expect(content).toBe("aaa\nBBB\nCCC\nddd");
	});
});
