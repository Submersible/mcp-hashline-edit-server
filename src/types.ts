/**
 * Shared types for the hashline edit server.
 */

export interface HashMismatch {
	line: number;
	expected: string;
	actual: string;
}

// Hashline edit operation types

export interface SetLineEdit {
	set_line: {
		anchor: string;
		new_text: string;
	};
}

export interface ReplaceLinesEdit {
	replace_lines: {
		start_anchor: string;
		end_anchor: string;
		new_text: string;
	};
}

export interface InsertAfterEdit {
	insert_after: {
		anchor: string;
		text: string;
	};
}

export interface ReplaceEdit {
	replace: {
		old_text: string;
		new_text: string;
		all?: boolean;
	};
}

export type HashlineEdit = SetLineEdit | ReplaceLinesEdit | InsertAfterEdit | ReplaceEdit;
