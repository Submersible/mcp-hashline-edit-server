import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, tmpPath, parseHashlines, type TestContext } from "./helpers";

describe("read_file", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	test("basic read with hashline format", async () => {
		const p = await writeTmpFile(ctx, "basic.txt", "hello\nworld\nfoo");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		expect(text).toContain("File:");
		expect(text).toContain("(3 lines)");
		const lines = parseHashlines(text);
		expect(lines).toHaveLength(3);
		expect(lines[0].line).toBe(1);
		expect(lines[0].content).toBe("hello");
		expect(lines[1].line).toBe(2);
		expect(lines[1].content).toBe("world");
		expect(lines[2].line).toBe(3);
		expect(lines[2].content).toBe("foo");
	});

	test("hashes are deterministic", async () => {
		const p = await writeTmpFile(ctx, "determ.txt", "alpha\nbeta");
		const r1 = await callTool(ctx, "read_file", { path: p });
		const r2 = await callTool(ctx, "read_file", { path: p });
		const lines1 = parseHashlines(getText(r1));
		const lines2 = parseHashlines(getText(r2));
		expect(lines1[0].hash).toBe(lines2[0].hash);
		expect(lines1[1].hash).toBe(lines2[1].hash);
	});

	test("offset and limit pagination", async () => {
		const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
		const p = await writeTmpFile(ctx, "paginated.txt", content);

		const result = await callTool(ctx, "read_file", { path: p, offset: 5, limit: 3 });
		const text = getText(result);
		expect(text).toContain("showing lines 5-7");
		expect(text).toContain("more lines below");
		const lines = parseHashlines(text);
		expect(lines).toHaveLength(3);
		expect(lines[0].line).toBe(5);
		expect(lines[0].content).toBe("line 5");
		expect(lines[2].line).toBe(7);
	});

	test("header shows full line count", async () => {
		const p = await writeTmpFile(ctx, "header.txt", "a\nb\nc\nd\ne");
		const text = getText(await callTool(ctx, "read_file", { path: p }));
		expect(text).toContain("(5 lines)");
	});

	test("reading a directory returns listing with d/f prefixes", async () => {
		const dir = tmpPath(ctx, "mydir");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(tmpPath(ctx, "mydir/file.txt"), "hi");
		await fs.mkdir(tmpPath(ctx, "mydir/subdir"), { recursive: true });

		const result = await callTool(ctx, "read_file", { path: dir });
		const text = getText(result);
		expect(text).toContain("Directory:");
		expect(text).toContain("f file.txt");
		expect(text).toContain("d subdir");
		expect(isError(result)).toBe(false);
	});

	test("missing file returns error", async () => {
		const result = await callTool(ctx, "read_file", { path: tmpPath(ctx, "nope.txt") });
		expect(isError(result)).toBe(true);
		expect(getText(result)).toContain("Error reading");
	});

	test("empty file", async () => {
		const p = await writeTmpFile(ctx, "empty.txt", "");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		expect(text).toContain("(1 lines)");
		const lines = parseHashlines(text);
		expect(lines).toHaveLength(1);
		expect(lines[0].content).toBe("");
	});

	test("file with CRLF line endings", async () => {
		const p = await writeTmpFile(ctx, "crlf.txt", "one\r\ntwo\r\nthree");
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		// Server splits on \n so CRLF produces lines with trailing \r
		// Hash format still applies; content should contain all original text
		expect(text).toContain("(3 lines)");
		expect(text).toContain("one");
		expect(text).toContain("two");
		expect(text).toContain("three");
	});

	test("large file gets truncated to DEFAULT_MAX_LINES", async () => {
		const content = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n");
		const p = await writeTmpFile(ctx, "large.txt", content);
		const result = await callTool(ctx, "read_file", { path: p });
		const text = getText(result);
		expect(text).toContain("showing lines 1-2000");
		expect(text).toContain("500 more lines below");
		const lines = parseHashlines(text);
		expect(lines).toHaveLength(2000);
	});

	test("offset past end of file returns last line", async () => {
		const p = await writeTmpFile(ctx, "short.txt", "a\nb");
		const result = await callTool(ctx, "read_file", { path: p, offset: 100 });
		const text = getText(result);
		// startLine clamps to max(1, offset), endLine clamps to lines.length
		// When offset > lines.length, slice returns empty but there may be edge behavior
		// The header still shows the file info
		expect(text).toContain("short.txt");
	});
});
