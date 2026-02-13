import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface TestContext {
	client: Client;
	tmpDir: string;
}

export async function setupContext(): Promise<TestContext> {
	const server = createServer();
	const client = new Client({ name: "test", version: "0.1.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
	return { client, tmpDir };
}

export async function teardownContext(ctx: TestContext) {
	await fs.rm(ctx.tmpDir, { recursive: true, force: true });
	await ctx.client.close();
}

export function callTool(ctx: TestContext, name: string, args: Record<string, unknown>) {
	return ctx.client.callTool({ name, arguments: args });
}

export function getText(result: Awaited<ReturnType<typeof callTool>>): string {
	const content = (result as { content: Array<{ type: string; text: string }> }).content;
	return content[0].text;
}

export function isError(result: Awaited<ReturnType<typeof callTool>>): boolean {
	return (result as { isError?: boolean }).isError === true;
}

export function tmpPath(ctx: TestContext, name: string): string {
	return path.join(ctx.tmpDir, name);
}

/** Write a temp file and return its absolute path */
export async function writeTmpFile(ctx: TestContext, name: string, content: string): Promise<string> {
	const p = tmpPath(ctx, name);
	await Bun.write(p, content);
	return p;
}

/** Parse LINE:HASH pairs from read_file output text */
export function parseHashlines(text: string): Array<{ line: number; hash: string; content: string }> {
	const results: Array<{ line: number; hash: string; content: string }> = [];
	for (const rawLine of text.split("\n")) {
		const m = rawLine.match(/^(\d+):([0-9a-f]{2})\|(.*)$/);
		if (m) results.push({ line: parseInt(m[1], 10), hash: m[2], content: m[3] });
	}
	return results;
}
