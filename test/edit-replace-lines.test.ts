import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — replace_lines", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("replace range of lines", async () => {
		const p = await writeTmpFile(ctx, "range1.txt", "aaa\nbbb\nccc\nddd\neee");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`;
		const endAnchor = `${lines[3].line}:${lines[3].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "REPLACED" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nREPLACED\neee");
	});

	test("delete range with empty new_text", async () => {
		const p = await writeTmpFile(ctx, "range-del.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[1].line}:${lines[1].hash}`;
		const endAnchor = `${lines[2].line}:${lines[2].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nddd");
	});

	test("start > end is an error", async () => {
		const p = await writeTmpFile(ctx, "range-err.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const startAnchor = `${lines[2].line}:${lines[2].hash}`;
		const endAnchor = `${lines[0].line}:${lines[0].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: startAnchor, end_anchor: endAnchor, new_text: "x" } }],
		});
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("must be <=");
	});

	test("replace single-line range (start == end)", async () => {
		const p = await writeTmpFile(ctx, "range-single.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ replace_lines: { start_anchor: anchor, end_anchor: anchor, new_text: "BBB2" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nBBB2\nccc");
	});
});
