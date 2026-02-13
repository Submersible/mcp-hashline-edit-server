# Development Guide

## Runtime

This project uses **Bun** exclusively. Do not use Node, npm, npx, or yarn.

```bash
# Bun binary location (if not in PATH)
~/.bun/bin/bun

# Install dependencies
bun install

# Run the server
bun run src/index.ts

# Type check
bunx tsc --noEmit

# Add a dependency
bun add <package>
bun add -d <package>  # dev dependency
```

**Never use:**
- `npm install`, `npm run`, `npx` — use `bun install`, `bun run`, `bunx`
- `node src/index.ts` — use `bun run src/index.ts`
- `tsc` directly — use `bunx tsc`

## Project Structure

```
src/
  index.ts        — Entry point, stdio transport (thin wrapper around server.ts)
  server.ts       — MCP server factory with all tool registrations
  hashline.ts     — Core hashline algorithm (hashing, formatting, parsing, edit application)
  types.ts        — Edit operation type definitions
  fuzzy.ts        — Fuzzy text matching (Levenshtein, line-level, character-level)
  diff.ts         — Diff generation and substr-style replace logic
  normalize.ts    — Line endings, BOM, Unicode normalization, indentation adjustment
  descriptions.ts — Tool description strings shown to the LLM
```

## Origin / Upstream

This project was extracted from the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding agent (`packages/coding-agent/`). Source mapping:

| This file | Ported from (oh-my-pi) |
|---|---|
| `src/hashline.ts` | `packages/coding-agent/src/patch/hashline.ts` |
| `src/types.ts` | `packages/coding-agent/src/patch/types.ts` + schema-derived types from `patch/index.ts` |
| `src/fuzzy.ts` | `packages/coding-agent/src/patch/fuzzy.ts` |
| `src/diff.ts` | `packages/coding-agent/src/patch/diff.ts` |
| `src/normalize.ts` | `packages/coding-agent/src/patch/normalize.ts` |
| `src/descriptions.ts` | `packages/coding-agent/src/prompts/tools/hashline.md`, `read.md`, `write.md`, `grep.md` |
| `src/server.ts` | `packages/coding-agent/src/patch/index.ts` (EditTool class, schemas) + `src/tools/read.ts`, `grep.ts`, `write.ts` |

Stripped during porting: `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-ai`, `@sinclair/typebox`, LSP writethrough, TUI rendering, settings system, Handlebars prompt templates. Replaced with: zod schemas (from MCP SDK), direct `Bun.write`, plain description strings.

## Architecture

The server exposes 4 MCP tools over stdio:

| Tool | Purpose |
|------|---------|
| `read_file` | Read files with `LINE:HASH\|content` prefixes |
| `edit_file` | Edit files using hash-verified line references |
| `write_file` | Create or overwrite files |
| `grep` | Search with hashline-prefixed results (requires `rg`) |

### Hashline Flow

1. `read_file` returns lines tagged with `LINE:HASH|content`
2. The LLM copies `LINE:HASH` refs verbatim into `edit_file` calls
3. `edit_file` validates hashes against current file content before mutating
4. If the file changed, hash mismatch errors show updated refs for retry

### Hash Algorithm

`computeLineHash` in `hashline.ts`:
- Strip `\r`, remove all whitespace
- `Bun.hash.xxHash32()` on the stripped string
- Modulo 256, encode as 2-char lowercase hex

This uses **Bun-specific APIs** (`Bun.hash.xxHash32`). The project cannot run on plain Node.

### Edit Application

`applyHashlineEdits` handles:
- Parsing all edit variants (`set_line`, `replace_lines`, `insert_after`, `replace`)
- Hash validation with relocation (if a line moved but hash still unique)
- Deduplication of identical edits
- Bottom-up sort so line number splicing doesn't invalidate later edits
- Heuristic corrections: boundary echo stripping, merge detection, indent restoration, confusable hyphen normalization

### Fuzzy Matching

The `replace` edit variant uses `replaceText` from `diff.ts` which delegates to `findMatch` in `fuzzy.ts`. Progressive fallback: exact match -> fuzzy line-level -> fuzzy character-level (Levenshtein).

## Testing

Manual testing via MCP protocol over stdio:

```bash
# Initialize + list tools
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | bun run src/index.ts
```

```bash
# Read a file
printf '...initialize...\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"/path/to/file"}}}\n' | bun run src/index.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run src/index.ts` | Start the MCP server |
| `bunx tsc --noEmit` | Type check |

## Code Style

- No `any` types unless absolutely necessary
- Use Bun APIs where available (`Bun.file()`, `Bun.write()`, `Bun.hash`, `Bun.spawn()`)
- Use `node:fs/promises` only for directory operations (Bun has no native dir APIs)
- Namespace imports for node modules: `import * as fs from "node:fs/promises"`
- No console.log in tool handlers — return errors via MCP `isError: true` responses

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `diff` — Unified diff generation for edit result display
- `zod` — Schema validation (transitive via MCP SDK)
- `rg` (ripgrep) — Required on system PATH for the `grep` tool
