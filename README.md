# mcp-hashline-edit-server

MCP server providing hashline-based file editing — line-addressed edits with content hashes for integrity verification.

Based on [hashline edit format](https://blog.can.ac/2026/02/12/the-harness-problem/) from [oh-my-pi](https://github.com/can1357/oh-my-pi).

## What is Hashline?

LLM reads file, every line tagged with short content hash:

```
1:a3|function hello() {
2:f1|  return "world";
3:0e|}
```

Model references tags when editing — "replace line `2:f1`", "replace range `1:a3` through `3:0e`", "insert after `3:0e`". If file changed since last read, hashes won't match, edit rejected before corruption.

Model doesn't need to reproduce old content/whitespace to identify changes. Benchmarks show hashline matches or beats `str_replace` for most models, weakest models gain most (up to 10x improvement).

## Requirements

- [Bun](https://bun.sh/) runtime (`Bun.hash.xxHash32` for line hashing)
- [ripgrep](https://github.com/BurnSushi/ripgrep) (`rg`) on PATH for `grep` tool

## Install

```bash
npm install mcp-hashline-edit-server
# or
bun add mcp-hashline-edit-server
```

## Usage

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hashline-edit": {
      "command": "bunx",
      "args": ["mcp-hashline-edit-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project root or global):

```json
{
  "mcpServers": {
    "hashline-edit": {
      "command": "bunx",
      "args": ["mcp-hashline-edit-server"]
    }
  }
}
```

### Any MCP client

Server runs over stdio:

```bash
bunx mcp-hashline-edit-server
```

### From source

```bash
git clone https://github.com/Submerisble/mcp-hashline-edit-server.git
cd mcp-hashline-edit-server
bun install
bun run src/index.ts
```

## Tools

### `read_file`

Read file with hashline-prefixed output (`LINE:HASH|content`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path (relative or absolute) |
| `offset` | number? | Start line (1-indexed) |
| `limit` | number? | Max lines (default: 2000) |

### `edit_file`

Edit file using hash-verified line references. Four edit variants:

**`set_line`** — Replace single line:
```json
{"set_line": {"anchor": "2:f1", "new_text": "  return \"universe\";"}}
```

**`replace_lines`** — Replace range:
```json
{"replace_lines": {"start_anchor": "1:a3", "end_anchor": "3:0e", "new_text": "function greet() {\n  return \"hi\";\n}"}}
```

**`insert_after`** — Insert after line:
```json
{"insert_after": {"anchor": "1:a3", "text": "  // new comment"}}
```

**`replace`** — Fuzzy substring replace (fallback, no hashes needed):
```json
{"replace": {"old_text": "return \"world\"", "new_text": "return \"universe\""}}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path |
| `edits` | array | Edit operations |

Edits validated atomically against file as last read. Sorted, applied bottom-up automatically.

### `write_file`

Create or overwrite file.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File path |
| `content` | string | Content to write |

### `grep`

Search files with hashline-prefixed results.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | string | Regex pattern |
| `path` | string? | File or directory |
| `glob` | string? | Filter by glob (e.g., `*.js`) |
| `type` | string? | Filter by file type |
| `i` | boolean? | Case-insensitive |
| `pre` | number? | Context lines before |
| `post` | number? | Context lines after |
| `limit` | number? | Max matches (default: 100) |

Requires `rg` (ripgrep) on system.

## How the Hash Works

1. Strip trailing `\r`
2. Remove all whitespace
3. `xxHash32` on whitespace-stripped string
4. Modulo 256, encode as 2-char lowercase hex (`00`-`ff`)

Hash whitespace-insensitive — indentation changes don't affect hash, references robust against reformatting.

## Error Recovery

**Hash mismatch**: Error shows updated `LINE:HASH` refs with `>>>` markers. Copy new refs, retry.

**No-op error**: Replacement matches current content. Re-read file for current state.

## License

[MIT](LICENSE)
