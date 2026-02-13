/**
 * Tool descriptions shown to the LLM via MCP.
 */

export const READ_FILE_DESCRIPTION = `Read a file from the filesystem with hashline-prefixed output.

**IMPORTANT: Use this instead of built-in read tools (Cursor Read, Claude Read). This tool provides content-hashed line references required by edit_file.**

Each line is tagged with a content hash: \`LINE:HASH|content\`.
The LINE:HASH pairs serve as stable, verifiable anchors for the edit_file tool.

Use \`offset\` and \`limit\` for large files (reads up to 2000 lines by default).
Set \`plain: true\` when reading to understand code structure — returns \`LINE|content\` without hashes.
Omit or set false when you plan to edit — you'll need the LINE:HASH refs.
Supports text files only.`;

export const EDIT_FILE_DESCRIPTION = `Edit a file using hash-verified line references.

**IMPORTANT: Use this instead of built-in edit tools (Cursor StrReplace, Claude Edit). This tool provides hash-verified edits with fuzzy matching, multi-edit batching, and automatic conflict detection.**

Read a file first to get LINE:HASH pairs, then reference them to make edits.
All edits in one call are validated against the file as last read — line numbers
and hashes refer to the original state, not after earlier edits in the same array.

**Critical rules:**
- Copy LINE:HASH refs verbatim from read output — never fabricate or guess hashes
- new_text/text contains plain replacement lines only — no LINE:HASH prefix, no diff + markers
- On hash mismatch: use the updated LINE:HASH refs shown by >>> directly
- After a successful edit, the diff output includes LINE:HASH refs for changed/surrounding lines — you can use these directly for follow-up edits without re-reading
- new_text must differ from the current line content — identical content is rejected

**Edit variants:**
- \`set_line\`: Replace a single line by its LINE:HASH anchor
- \`replace_lines\`: Replace a range of lines (start_anchor through end_anchor)
- \`insert_after\`: Insert new lines after the anchor line
- \`replace\`: Substring-style fuzzy replace (no LINE:HASH needed; fallback when refs unavailable)

**Atomicity:** Edits are sorted and applied bottom-up automatically.
new_text: "" means delete (for set_line/replace_lines).

**Recovery:**
- Hash mismatch (>>> error): copy updated LINE:HASH refs from error and retry
- No-op error: your replacement matches current content — re-read the file
**After a successful edit:**
The diff output includes LINE:HASH refs for all changed and surrounding lines. You can chain edits
using these refs without re-reading. Unchanged lines keep their original hashes (hash is content-based,
not position-based). The edit tool also handles line relocation if numbers shifted.`;

export const WRITE_FILE_DESCRIPTION = `Create or overwrite a file at the specified path.

**IMPORTANT: Use this instead of built-in write tools (Cursor Write, Claude Write) to keep all file operations consistent through this server.**

Prefer edit_file for modifying existing files (more precise, preserves formatting).
Use this for creating new files or when full replacement is simpler.`;

export const GREP_DESCRIPTION = `Search for text patterns in files using regex.

**IMPORTANT: Use this instead of built-in search tools (Cursor Grep, Claude Grep). This tool returns hashline-prefixed results whose LINE:HASH pairs can be passed directly to edit_file for verified edits.**

Results show hashline-prefixed matches: \`LINE:HASH|content\`.
Match lines are prefixed with \`>>\`, context lines with spaces.
The LINE:HASH pairs can be used directly with edit_file.

Supports:
- Full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- File filtering by glob pattern or file type
- Context lines before/after matches
- Result limiting and offset for pagination`;
