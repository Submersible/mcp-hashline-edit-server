import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — insert_after", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("insert single line after anchor", async () => {
		const p = await writeTmpFile(ctx, "ins1.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor, text: "INSERTED" } }],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nbbb\nINSERTED\nccc");
	});

	test("insert multiple lines", async () => {
		const p = await writeTmpFile(ctx, "ins-multi.txt", "aaa\nbbb");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[0].line}:${lines[0].hash}`;

		await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor, text: "X\nY\nZ" } }],
		});
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nX\nY\nZ\nbbb");
	});

	test("insert after last line", async () => {
		const p = await writeTmpFile(ctx, "ins-last.txt", "aaa\nbbb");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const anchor = `${lines[1].line}:${lines[1].hash}`;

		await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor, text: "ccc" } }],
		});
		const content = await Bun.file(p).text();
		expect(content).toBe("aaa\nbbb\nccc");
	});

	test("wrong hash on insert_after returns mismatch", async () => {
		const p = await writeTmpFile(ctx, "ins-bad.txt", "aaa\nbbb");
		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ insert_after: { anchor: "1:zz", text: "new" } }],
		});
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain(">>>");
	});
});
