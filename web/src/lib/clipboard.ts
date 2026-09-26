// Clipboard of the inbox (E4 plan, package 6): reading the text through the async Clipboard API,
// with the cases where a browser refuses it, and turning a text into inbox drafts. Reading needs
// a user action (button); pasting with Ctrl+V needs no permission and goes through the paste
// event, so it stays the way when the browser refuses (Firefox without clipboard permission).

import type { InboxDraft } from './domain/inbox';
import { INBOX_BODY_MAX_LENGTH } from './domain/inbox';
import { isTypingTarget } from './domain/keyboard';
import { fitTitle } from './domain/templates';

/** At most this many entries from one text with "Jede Zeile als eigener Eintrag". */
export const CLIPBOARD_MAX_LINES = 100;

export const CLIPBOARD_DENIED_MESSAGE =
	'Der Browser erlaubt das Lesen der Zwischenablage nicht. Bitte in der Eingangsansicht Strg+V drücken.';
export const CLIPBOARD_EMPTY_MESSAGE = 'Die Zwischenablage enthält keinen Text.';
export const CLIPBOARD_TOO_MANY_MESSAGE = `Höchstens ${CLIPBOARD_MAX_LINES} Zeilen auf einmal.`;

export type ClipboardRead = { ok: true; text: string } | { ok: false; message: string };

/** The part of `navigator` that is read; tests pass a fake. */
export interface ClipboardSource {
	clipboard?: { readText?: () => Promise<string> };
}

/**
 * Text of the clipboard. A missing API, a refused permission or any other failure gives the hint
 * on Ctrl+V; an empty or whitespace-only text is refused as empty.
 */
export async function readClipboardText(
	source: ClipboardSource | undefined = typeof navigator === 'undefined' ? undefined : navigator
): Promise<ClipboardRead> {
	const read = source?.clipboard?.readText;
	if (typeof read !== 'function') return { ok: false, message: CLIPBOARD_DENIED_MESSAGE };
	try {
		const text = await read.call(source?.clipboard);
		return text.trim() === ''
			? { ok: false, message: CLIPBOARD_EMPTY_MESSAGE }
			: { ok: true, text };
	} catch {
		return { ok: false, message: CLIPBOARD_DENIED_MESSAGE };
	}
}

/** The part of `navigator` that is written to; tests pass a fake. */
export interface ClipboardTarget {
	clipboard?: { writeText?: (text: string) => Promise<void> };
}

/**
 * Writes a text to the clipboard (ADR-0026 section 6, CodeBlock). A missing API or a refusal gives
 * `false`; the caller then selects the text and names Ctrl+C. The text is never logged.
 */
export async function writeClipboardText(
	text: string,
	target: ClipboardTarget | undefined = typeof navigator === 'undefined' ? undefined : navigator
): Promise<boolean> {
	const write = target?.clipboard?.writeText;
	if (typeof write !== 'function') return false;
	try {
		await write.call(target?.clipboard, text);
		return true;
	} catch {
		return false;
	}
}

/** Non-empty lines of a text, trimmed. */
export function textLines(text: string): string[] {
	return text
		.split(/\r\n|\r|\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '');
}

export type ClipboardDrafts = { ok: true; drafts: InboxDraft[] } | { ok: false; message: string };

/**
 * Inbox entries of a pasted text (channel "clipboard", kind "todo"): the first line is the title
 * and the rest the text, or with `eachLine` one entry per line (at most CLIPBOARD_MAX_LINES).
 */
export function clipboardDrafts(text: string, { eachLine = false } = {}): ClipboardDrafts {
	const lines = textLines(text);
	if (lines.length === 0) return { ok: false, message: CLIPBOARD_EMPTY_MESSAGE };
	const draft = (title: string, body = ''): InboxDraft => ({
		channel: 'clipboard',
		kind: 'todo',
		title: fitTitle(title.replace(/\s+/g, ' ').trim()),
		body: body.slice(0, INBOX_BODY_MAX_LENGTH)
	});
	if (eachLine) {
		if (lines.length > CLIPBOARD_MAX_LINES)
			return { ok: false, message: CLIPBOARD_TOO_MANY_MESSAGE };
		return { ok: true, drafts: lines.map((line) => draft(line)) };
	}
	const [first, ...rest] = text.replace(/^\s+/, '').split(/\r\n|\r|\n/);
	return { ok: true, drafts: [draft(first ?? '', rest.join('\n').trim())] };
}

/**
 * Text of a paste event for the inbox (Ctrl+V in the view), or null if the paste belongs to a
 * field, a dialog or a popover, or carries no text.
 */
export function pastedText(event: Pick<ClipboardEvent, 'target' | 'clipboardData'>): string | null {
	if (isTypingTarget(event)) return null;
	const text = event.clipboardData?.getData('text/plain') ?? '';
	return text.trim() === '' ? null : text;
}
