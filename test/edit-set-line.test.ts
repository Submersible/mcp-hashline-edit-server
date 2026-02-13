import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — set_line", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("replace single line using correct LINE:HASH", async () => {
		const p = await writeTmpFile(ctx, "set1.txt", "aaa\nbbb\nccc");
		const readResult = await callTool(ctx, "read_file", { path: p });
		const lines = parseHashlines(getText(readResult));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "BBB_REPLACED" } }],
		});
		expect(isError(editResult)).toBe(false);
		expect(getText(editResult)).toContain("Updated");

		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nBBB_REPLACED\nccc");
	});

	test("delete line with empty new_text", async () => {
		const p = await writeTmpFile(ctx, "set-del.txt", "keep\ndelete-me\nalso-keep");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("keep\nalso-keep");
	});

	test("replace with multiple lines (expanding)", async () => {
		const p = await writeTmpFile(ctx, "set-expand.txt", "one\ntwo\nthree");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "TWO-A\nTWO-B\nTWO-C" } }],
		});
		const content = await Bun.file(p).text();
		expect(content).toBe("one\nTWO-A\nTWO-B\nTWO-C\nthree");
	});

	test("wrong hash returns mismatch error with >>> markers", async () => {
		const p = await writeTmpFile(ctx, "set-mismatch.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: "2:zz", new_text: "new" } }],
		});
		expect(isError(result)).toBe(true);
		const text = getText(result);
		expect(text).toContain(">>>");
		expect(text).toContain("changed since last read");
	});

	test("no-op replacement (identical content) returns error", async () => {
		const p = await writeTmpFile(ctx, "set-noop.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor, new_text: "bbb" } }],
		});
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("No changes made");
	});
});
