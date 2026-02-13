# Cursor Built-in Tool Overlap

The 4 MCP tools this server exposes overlap with Cursor's native tools. This documents how Cursor's versions work and where they differ.

## read_file → Cursor `Read`

Cursor's Read tool returns raw file content with `LINE_NUMBER|LINE_CONTENT` formatting (line numbers right-aligned, padded to 6 chars). It accepts optional `offset` (1-indexed or negative from end) and `limit` params. It can also read images (jpeg, png, gif, webp) and PDFs.

**Differences:**
- No content hashing — lines are plain numbered, not `LINE:HASH|content`
- No directory listing fallback — reading a directory is not supported
- Supports images and PDFs natively
- No default truncation limit (caller decides `limit`)

## edit_file → Cursor `StrReplace`

Cursor's StrReplace does exact string replacement: provide `old_string` and `new_string`, and it replaces one occurrence in the file. Set `replace_all: true` to replace all occurrences.

**Differences:**
- No hash verification — relies on `old_string` being unique in the file (fails if not unique)
- No line-addressed edits — no equivalent of `set_line`, `replace_lines`, or `insert_after`
- No fuzzy matching — match must be exact (including whitespace and indentation)
- No bottom-up multi-edit batching — one replacement per call
- Simpler mental model but less precise for targeted single-line changes

## write_file → Cursor `Write`

Cursor's Write tool creates or overwrites a file at a given path. Takes `path` and `contents`.

**Differences:**
- Essentially identical behavior
- No line count reporting in response

## grep → Cursor `Grep`

Cursor's Grep tool uses ripgrep internally. Supports regex patterns, glob filters, file type filters, context lines (`-A`, `-B`, `-C`), case-insensitive flag, output modes (`content`, `files_with_matches`, `count`), and pagination via `head_limit`/`offset`.

**Differences:**
- No hashline formatting — output is standard ripgrep format
- Results can't feed directly into edit_file anchors
- Has `files_with_matches` and `count` output modes (the MCP grep only returns content)
- Supports `multiline` matching mode
- Has built-in result capping for responsiveness
