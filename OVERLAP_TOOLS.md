# Tool Overlap: MCP Hashline Server vs Built-in Tools

All 4 tools this server exposes have equivalents in both Claude Code and Cursor.

| MCP Server Tool | Claude Code | Cursor | Key Differentiator |
|---|---|---|---|
| `read_file` | Read | Read | Server adds `LINE:HASH\|content` prefixes for edit anchoring |
| `edit_file` | Edit | StrReplace | Server uses hash-verified line anchors + fuzzy replace; built-ins use exact string matching |
| `write_file` | Write | Write | Nearly identical across all three |
| `grep` | Grep | Grep | Server reformats rg output with hashline prefixes so results chain into `edit_file` |

---

## read_file

**What the server does:** Returns each line as `LINE:HASH|content` where HASH is a 2-char hex digest (xxHash32 mod 256) of whitespace-stripped content. Supports `offset`/`limit` pagination (default max 2000 lines). Falls back to directory listing with `d`/`f` prefixes if the path is a directory.

**Claude Code — Read:** Returns content with line numbers in `cat -n` format. Optional `offset` and `limit`. Can also read images, PDFs, and Jupyter notebooks. No hashing, no directory fallback.

**Cursor — Read:** Returns content as `LINE_NUMBER|LINE_CONTENT` (right-aligned, padded to 6 chars). Optional `offset` (supports negative for end-relative) and `limit`. Can read images and PDFs. No hashing, no directory fallback, no default truncation.

## edit_file

**What the server does:** Four edit variants, all validated against file state:
- `set_line` — replace a single line by `LINE:HASH` anchor
- `replace_lines` — replace a range (start_anchor through end_anchor)
- `insert_after` — insert lines after an anchor
- `replace` — fuzzy substring replace (no hashes needed)

Multiple edits in one call are sorted bottom-up so splicing doesn't invalidate later line numbers. Hash mismatches return `>>>` markers with updated refs. Includes heuristics for boundary echo stripping, merge detection, indent restoration, and confusable hyphen normalization.

**Claude Code — Edit:** Exact string replacement (`old_string` → `new_string`). Match must be unique or use `replace_all`. No line anchoring, no hash verification, no fuzzy matching, one replacement per call.

**Cursor — StrReplace:** Same model as Claude Code's Edit. Exact `old_string` → `new_string`, must be unique in file. Optional `replace_all`. No line-addressed edits, no fuzzy matching, no multi-edit batching.

## write_file

**What the server does:** Creates or overwrites a file. Reports line count in response. Parent directories created automatically by `Bun.write`.

**Claude Code — Write:** Creates or overwrites a file at an absolute path. Functionally identical.

**Cursor — Write:** Creates or overwrites a file. Functionally identical. No line count reporting.

## grep

**What the server does:** Wraps `rg` with `--line-number --no-heading`. Reformats output so match lines become `file:>>LINE:HASH|content` and context lines become `file:  LINE:HASH|content`. Supports regex, glob, file type, case-insensitive, pre/post context, and limit. The hashline-prefixed output chains directly into `edit_file` anchors.

**Claude Code — Grep:** Built on ripgrep. Regex, glob/type filters, context lines (`-A`/`-B`/`-C`), case-insensitive. Multiple output modes: `content`, `files_with_matches`, `count`. Standard rg output format (no hashline prefixes).

**Cursor — Grep:** Built on ripgrep. Same feature set as Claude Code's Grep plus `multiline` matching mode and pagination via `head_limit`/`offset`. Built-in result capping. Standard rg output (no hashline prefixes).
