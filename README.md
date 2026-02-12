# mcp-hashline-edit-server

An MCP (Model Context Protocol) server that provides hashline-based file editing tools — line-addressed edits using content hashes for integrity verification.

Based on the [hashline edit format](https://blog.can.ac/2026/02/12/the-harness-problem/) from [oh-my-pi](https://github.com/can1357/oh-my-pi).

## What is Hashline?

When an LLM reads a file, every line comes back tagged with a short content hash:

```
1:a3|function hello() {
2:f1|  return "world";
3:0e|}
```

When editing, the model references those tags — "replace line `2:f1`", "replace range `1:a3` through `3:0e`", "insert after `3:0e`". If the file changed since the last read, the hashes won't match and the edit is rejected before anything gets corrupted.

This means the model doesn't need to reproduce old content (or whitespace) to identify what it wants to change. Benchmark results show hashline matches or beats traditional `str_replace` for most models, with the weakest models gaining the most (up to 10x improvement).

## Requirements

- [Bun](https://bun.sh/) runtime (uses `Bun.hash.xxHash32` for line hashing)

## Install

```bash
cd mcp-hashline-edit-server
bun install
```

## Usage

### With Claude Desktop / Cursor / any MCP client

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "hashline-edit": {
      "command": "bun",
      "args": ["run", "/path/to/mcp-hashline-edit-server/src/index.ts"]
    }
  }
}
```

### Running directly

```bash
bun run src/index.ts
```

The server communicates via stdio using the MCP protocol.

## Tools

### `read_file`

Read a file with hashline-prefixed output (`LINE:HASH|content`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path (relative or absolute) |
| `offset` | number? | Line number to start from (1-indexed) |
| `limit` | number? | Max lines to read (default: 2000) |

### `edit_file`

Edit a file using hash-verified line references. Supports four edit variants:

**`set_line`** — Replace a single line:
```json
{"set_line": {"anchor": "2:f1", "new_text": "  return \"universe\";"}}
```

**`replace_lines`** — Replace a range:
```json
{"replace_lines": {"start_anchor": "1:a3", "end_anchor": "3:0e", "new_text": "function greet() {\n  return \"hi\";\n}"}}
```

**`insert_after`** — Insert after a line:
```json
{"insert_after": {"anchor": "1:a3", "text": "  // new comment"}}
```

**`replace`** — Substring fuzzy replace (fallback, no hashes needed):
```json
{"replace": {"old_text": "return \"world\"", "new_text": "return \"universe\""}}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path |
| `edits` | array | Array of edit operations |

All edits are validated atomically against the file as last read. Edits are sorted and applied bottom-up automatically.

### `write_file`

Create or overwrite a file.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path |
| `content` | string | Content to write |

### `grep`

Search files with hashline-prefixed results.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | string | Regex pattern |
| `path` | string? | File or directory to search |
| `glob` | string? | Filter by glob (e.g., `*.js`) |
| `type` | string? | Filter by file type |
| `i` | boolean? | Case-insensitive |
| `pre` | number? | Context lines before |
| `post` | number? | Context lines after |
| `limit` | number? | Max matches (default: 100) |

Requires `rg` (ripgrep) installed on the system.

## How the Hash Works

1. Strip trailing `\r`
2. Remove all whitespace from the line
3. Compute `xxHash32` on the whitespace-stripped string
4. Modulo 256, encode as 2-character lowercase hex (`00`-`ff`)

The hash is whitespace-insensitive — indentation changes alone don't change the hash, making references robust against reformatting.

## Error Recovery

**Hash mismatch**: The error shows updated `LINE:HASH` refs with `>>>` markers. Copy the new refs and retry.

**No-op error**: The replacement text matches current content. Re-read the file to see current state.

## License

MIT
