// Input of a list of words in one field: the keyword editor (ADR-0020, user feedback package A,
// #83) and the tag picker in the ticket (plan e6-spalten, "Tags"). Pure; both components use the
// same rules:
// - a comma takes the text before the caret, Enter the whole field;
// - a pasted list with commas or line breaks becomes several entries at once;
// - Backspace in the empty field brings the last entry back as editable text (only the first
//   press of a held key; further presses delete as usual once there is text).

const LIST_SEPARATOR = /[,\r\n]/;

/** Whether `text` holds a separator (comma or line break). */
export function hasListSeparator(text: string): boolean {
	return LIST_SEPARATOR.test(text);
}

/**
 * Splits the text of the input field at commas and line breaks: the finished entries (trimmed,
 * empty ones left out) and the rest after the last separator, which stays in the field. With
 * `finish` the rest counts as finished too (Enter, pasting a list).
 */
export function splitListInput(text: string, finish: boolean): { parts: string[]; rest: string } {
	const pieces = text.split(LIST_SEPARATOR);
	const rest = finish ? '' : (pieces.pop() ?? '');
	return { parts: pieces.map((piece) => piece.trim()).filter((piece) => piece !== ''), rest };
}

/**
 * What a key press in the field means:
 * - `finish`: Enter, take the whole field (not with Ctrl or Cmd, that belongs to the form)
 * - `separate`: a typed comma, take the text before the caret
 * - `take-back`: Backspace in the empty field while the list has entries
 * - `hold`: the same Backspace held down; it repeats, but only the first press takes one back
 * - `null`: nothing special, the field handles the key
 * The caller prevents the default for every value but null.
 */
export type ListInputAction = 'finish' | 'separate' | 'take-back' | 'hold';

export function listInputAction(
	event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'repeat'>,
	text: string,
	hasEntries: boolean
): ListInputAction | null {
	if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) return 'finish';
	if (event.key === ',') return 'separate';
	if (event.key === 'Backspace' && text === '' && hasEntries) {
		return event.repeat ? 'hold' : 'take-back';
	}
	return null;
}

/** The field around a caret: the text before it (to take) and after it (to keep). */
export function splitAtCaret(
	text: string,
	start: number | null,
	end: number | null
): { before: string; after: string } {
	const from = start ?? text.length;
	return { before: text.slice(0, from), after: text.slice(end ?? from) };
}
