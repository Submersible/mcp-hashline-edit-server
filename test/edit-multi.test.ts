import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, parseHashlines, type TestContext } from "./helpers";

describe("edit_file — multiple edits", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("multiple set_line edits in one call (bottom-up application)", async () => {
		const p = await writeTmpFile(ctx, "multi1.txt", "aaa\nbbb\nccc\nddd");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [
				{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "AAA" } },
				{ set_line: { anchor: `${lines[2].line}:${lines[2].hash}`, new_text: "CCC" } },
				{ set_line: { anchor: `${lines[3].line}:${lines[3].hash}`, new_text: "DDD" } },
			],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("AAA\nbbb\nCCC\nDDD");
	});

	test("mix of anchor edits and replace edits", async () => {
		const p = await writeTmpFile(ctx, "multi-mix.txt", "alpha\nbeta\ngamma\ndelta");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [
				{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "ALPHA" } },
				{ replace: { old_text: "gamma", new_text: "GAMMA" } },
			],
		});
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("ALPHA\nbeta\nGAMMA\ndelta");
	});

	test("file actually changes on disk after edit", async () => {
		const p = await writeTmpFile(ctx, "disk-check.txt", "original");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));

		await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${lines[0].line}:${lines[0].hash}`, new_text: "modified" } }],
		});
		const diskContent = await Bun.file(p).text();
		expect(diskContent).toBe("modified");
	});
});

describe("edit_file — round-trip", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("read -> extract hashes -> edit -> read again -> verify", async () => {
		const p = await writeTmpFile(ctx, "rt1.txt", "line-one\nline-two\nline-three");

		// Read and extract hashes
		const read1 = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		expect(read1).toHaveLength(3);

		// Edit line 2
		await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${read1[1].line}:${read1[1].hash}`, new_text: "LINE-TWO-EDITED" } }],
		});

		// Read again and verify
		const read2 = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		expect(read2).toHaveLength(3);
		expect(read2[0].content).toBe("line-one");
		expect(read2[1].content).toBe("LINE-TWO-EDITED");
		expect(read2[2].content).toBe("line-three");
		// Line 1 and 3 hashes should be unchanged
		expect(read2[0].hash).toBe(read1[0].hash);
		expect(read2[2].hash).toBe(read1[2].hash);
		// Line 2 hash should have changed
		expect(read2[1].hash).not.toBe(read1[1].hash);
	});

	test("write_file -> read_file -> edit_file -> read_file full flow", async () => {
		const p = `${ctx.tmpDir}/flow.txt`;

		// Write
		await callTool(ctx, "write_file", { path: p, content: "first\nsecond\nthird" });

		// Read
		const read1 = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		expect(read1).toHaveLength(3);

		// Edit
		const editResult = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${read1[1].line}:${read1[1].hash}`, new_text: "SECOND" } }],
		});
		expect(isError(editResult)).toBe(false);

		// Read again
		const read2 = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		expect(read2[1].content).toBe("SECOND");
	});

	test("edit returns diff output", async () => {
		const p = await writeTmpFile(ctx, "diff-out.txt", "aaa\nbbb\nccc");
		const lines = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));

		const result = await callTool(ctx, "edit_file", {
			path: p,
			edits: [{ set_line: { anchor: `${lines[1].line}:${lines[1].hash}`, new_text: "BBB" } }],
		});
		const text = getText(result);
		expect(text).toContain("Diff:");
		expect(text).toContain("-");
		expect(text).toContain("+");
	});
});
