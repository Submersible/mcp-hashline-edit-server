import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import { setupContext, teardownContext, callTool, getText, isError, writeTmpFile, tmpPath, parseHashlines, type TestContext } from "./helpers";

describe("grep", () => {
	let ctx: TestContext;
	beforeAll(async () => { ctx = await setupContext(); });
	afterAll(async () => { await teardownContext(ctx); });

	// rg omits filename when searching a single file unless --with-filename
	// is passed. Our grep tool must always produce hashline-formatted output.

	async function writeInDir(name: string, fileName: string, content: string): Promise<string> {
		const dir = tmpPath(ctx, name);
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/${fileName}`, content);
		return dir;
	}

	test("basic pattern match with hashline format", async () => {
		const dir = await writeInDir("grep1", "file.txt", "hello world\nfoo bar\nhello again");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir });
		const text = getText(result);
		// Match lines have >> prefix in directory mode
		expect(text).toContain(":>>");
		expect(text).toMatch(/\d+:[0-9a-f]{2}\|/);
		expect(text).toContain("hello world");
		expect(text).toContain("hello again");
		expect(text).not.toContain("foo bar");
	});

	test("case-insensitive search", async () => {
		const dir = await writeInDir("grep-ci", "file.txt", "Hello\nhello\nHELLO\nworld");
		const result = await callTool(ctx, "grep", { pattern: "hello", path: dir, i: true });
		const text = getText(result);
		expect(text).toContain("Hello");
		expect(text).toContain("hello");
		expect(text).toContain("HELLO");
	});

	test("context lines with pre/post", async () => {
		const dir = await writeInDir("grep-ctx", "file.txt", "aaa\nbbb\nTARGET\nddd\neee");
		const result = await callTool(ctx, "grep", { pattern: "TARGET", path: dir, pre: 1, post: 1 });
		const text = getText(result);
		expect(text).toContain("TARGET");
		// Context lines should be present
		expect(text).toContain("bbb");
		expect(text).toContain("ddd");
	});

	test("glob filter", async () => {
		const dir = tmpPath(ctx, "grep-glob");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/file.js`, "const x = 1;");
		await Bun.write(`${dir}/file.py`, "x = 1");
		await Bun.write(`${dir}/file.txt`, "x = 1");

		const result = await callTool(ctx, "grep", { pattern: "x", path: dir, glob: "*.js" });
		const text = getText(result);
		expect(text).toContain("file.js");
		expect(text).not.toContain("file.py");
		expect(text).not.toContain("file.txt");
	});

	test("file type filter", async () => {
		const dir = tmpPath(ctx, "grep-type");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/app.js`, "const y = 2;");
		await Bun.write(`${dir}/app.py`, "y = 2");

		const result = await callTool(ctx, "grep", { pattern: "y", path: dir, type: "js" });
		const text = getText(result);
		expect(text).toContain("app.js");
		expect(text).not.toContain("app.py");
	});

	test("limit results", async () => {
		const lines = Array.from({ length: 50 }, (_, i) => `match_line_${i}`).join("\n");
		const dir = await writeInDir("grep-limit", "file.txt", lines);
		const result = await callTool(ctx, "grep", { pattern: "match_line", path: dir, limit: 5 });
		const text = getText(result);
		const matchLines = text.split("\n").filter((l: string) => l.includes(":>>"));
		expect(matchLines.length).toBe(5);
	});

	test("no matches returns 'No matches found.'", async () => {
		const dir = await writeInDir("grep-none", "file.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "zzzzzzz", path: dir });
		expect(getText(result)).toBe("No matches found.");
	});

	test("search in directory with multiple files", async () => {
		const dir = tmpPath(ctx, "grep-dir");
		await fs.mkdir(dir, { recursive: true });
		await Bun.write(`${dir}/a.txt`, "findme here");
		await Bun.write(`${dir}/b.txt`, "nothing");

		const result = await callTool(ctx, "grep", { pattern: "findme", path: dir });
		const text = getText(result);
		expect(text).toContain("a.txt");
		expect(text).toContain("findme here");
	});

	test("regex pattern", async () => {
		const dir = await writeInDir("grep-regex", "file.txt", "foo123\nbar456\nfoo789");
		const result = await callTool(ctx, "grep", { pattern: "foo\\d+", path: dir });
		const text = getText(result);
		expect(text).toContain("foo123");
		expect(text).toContain("foo789");
		expect(text).not.toContain("bar456");
	});

	test("hashes in grep output match hashes from read_file", async () => {
		const dir = await writeInDir("grep-hash", "file.txt", "unique_alpha\nunique_beta\nunique_gamma");
		const filePath = `${dir}/file.txt`;

		// Read to get canonical hashes
		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: filePath })));

		// Grep for "unique_beta" in directory so we get hashline format
		const grepResult = await callTool(ctx, "grep", { pattern: "unique_beta", path: dir });
		const grepText = getText(grepResult);

		// Extract hash from grep output: file:>>LINE:HASH|content
		const grepMatch = grepText.match(/>>(\d+):([0-9a-f]{2})\|unique_beta/);
		expect(grepMatch).not.toBeNull();

		const grepLine = parseInt(grepMatch![1], 10);
		const grepHash = grepMatch![2];

		// Should match the hash from read_file for the same line
		const readLine = readResult.find((l) => l.content === "unique_beta");
		expect(readLine).toBeDefined();
		expect(grepHash).toBe(readLine!.hash);
		expect(grepLine).toBe(readLine!.line);
	});

	test("single-file grep produces hashline-formatted output", async () => {
		const p = await writeTmpFile(ctx, "grep-single.txt", "aaa\nbbb\nccc");
		const result = await callTool(ctx, "grep", { pattern: "bbb", path: p });
		const text = getText(result);
		// Should have hash format even for single-file search
		expect(text).toMatch(/>>(\d+):([0-9a-f]{2})\|bbb/);
	});

	test("single-file grep hashes match read_file hashes", async () => {
		const p = await writeTmpFile(ctx, "grep-single-hash.txt", "alpha\nbeta\ngamma");
		const readResult = parseHashlines(getText(await callTool(ctx, "read_file", { path: p })));
		const grepResult = await callTool(ctx, "grep", { pattern: "beta", path: p });
		const grepText = getText(grepResult);
		const grepMatch = grepText.match(/>>(\d+):([0-9a-f]{2})\|beta/);
		expect(grepMatch).not.toBeNull();
		const readLine = readResult.find((l) => l.content === "beta");
		expect(readLine).toBeDefined();
		expect(grepMatch![2]).toBe(readLine!.hash);
	});
});
