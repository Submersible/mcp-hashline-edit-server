import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import { setupContext, teardownContext, callTool, getText, isError, tmpPath, type TestContext } from "./helpers";

describe("write_file", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("create new file and verify content on disk", async () => {
		const p = tmpPath(ctx, "new-file.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "hello\nworld" });
		expect(isError(result)).toBe(false);
		expect(getText(result)).toContain("Created");
		const content = await Bun.file(p).text();
		expect(content).toBe("hello\nworld");
	});

	test("overwrite existing file", async () => {
		const p = tmpPath(ctx, "overwrite.txt");
		await Bun.write(p, "old content");
		const result = await callTool(ctx, "write_file", { path: p, content: "new content" });
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("new content");
	});

	test("creates parent directories automatically", async () => {
		const p = tmpPath(ctx, "nested/deep/dir/file.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "nested" });
		expect(isError(result)).toBe(false);
		const content = await Bun.file(p).text();
		expect(content).toBe("nested");
	});

	test("reports correct line count", async () => {
		const p = tmpPath(ctx, "linecount.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "a\nb\nc\nd" });
		expect(getText(result)).toContain("4 lines");
	});

	test("write empty content", async () => {
		const p = tmpPath(ctx, "empty-write.txt");
		const result = await callTool(ctx, "write_file", { path: p, content: "" });
		expect(isError(result)).toBe(false);
		expect(getText(result)).toContain("1 lines");
		const content = await Bun.file(p).text();
		expect(content).toBe("");
	});

	test("write content with special characters", async () => {
		const p = tmpPath(ctx, "special.txt");
		const special = "line1: 日本語\nline2: émojis 🎉\nline3: tabs\there";
		await callTool(ctx, "write_file", { path: p, content: special });
		const content = await Bun.file(p).text();
		expect(content).toBe(special);
	});
});
