# Built-in Claude Code Tools That Overlap With This Server

## Read
- **Overlaps with:** `read_file`
- Reads files by absolute path with optional `offset` (line number) and `limit` (line count) for pagination.
- Returns contents with line numbers (cat -n format). Does not add hash prefixes.
- Can also read images, PDFs, and Jupyter notebooks.

## Edit
- **Overlaps with:** `edit_file`
- Performs exact string replacement: matches `old_string` in the file and replaces it with `new_string`.
- The match must be unique in the file (or `replace_all` can be set to replace every occurrence).
- Does not use line-based anchoring or hash verification — relies on exact text matching instead.

## Write
- **Overlaps with:** `write_file`
- Creates or overwrites a file at a given absolute path.

## Grep
- **Overlaps with:** `grep`
- Built on ripgrep. Supports regex patterns, glob/type filters, context lines (`-A`/`-B`/`-C`), case-insensitive search, and multiple output modes (`content`, `files_with_matches`, `count`).
- Does not add hashline prefixes to results.
