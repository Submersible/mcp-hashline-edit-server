import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — replace (fuzzy)", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("exact substring replace", async () => {
		const p = await writeTmpFile(ctx, "rep1.txt", "hello world\nfoo bar\nbaz");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "foo bar", new_text: "FOO BAR" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("hello world\nFOO BAR\nbaz");
	});

	test("fuzzy whitespace match", async () => {
		const p = await writeTmpFile(ctx, "rep-fuzzy.txt", "  function  hello() {\n    return 1;\n  }");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "function hello() {\n  return 1;\n}", new_text: "function hello() {\n  return 2;\n}" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toContain("return 2");
	});

	test("all: true replaces all occurrences", async () => {
		const p = await writeTmpFile(ctx, "rep-all.txt", "cat\ndog\ncat\nbird\ncat");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "cat", new_text: "CAT", all: true } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("CAT\ndog\nCAT\nbird\nCAT");
	});

	test("multiple ambiguous occurrences without all flag returns error", async () => {
		const p = await writeTmpFile(ctx, "rep-ambig.txt", "cat\ndog\ncat\nbird");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "cat", new_text: "CAT" } }],
		});
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("occurrences");
	});

	test("empty old_text returns error", async () => {
		const p = await writeTmpFile(ctx, "rep-empty.txt", "hello");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "", new_text: "x" } }],
		});
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("must not be empty");
	});

	test("multi-line exact replace", async () => {
		const p = await writeTmpFile(ctx, "rep-multiline.txt", "aaa\nbbb\nccc\nddd");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace: { old_text: "bbb\nccc", new_text: "BBB\nCCC" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nBBB\nCCC\nddd");
	});
});
