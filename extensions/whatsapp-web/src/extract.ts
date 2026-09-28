// Reads the open chat of WhatsApp Web (ADR-0038 §3): which messages there are, their text,
// sender, time and ID, the name of the chat and whether the page looks as expected. Reads only;
// the only element the extension adds is its own button (content-core.ts). Media without text
// (pictures, voice and video messages, stickers) have no text block and are left out: without a
// text nothing could become a ticket. A caption is the text of its picture.

import { ID_ATTRIBUTE, OWN_ATTRIBUTE, PRE_PLAIN_ATTRIBUTE, SELECTORS } from './selectors';
import { parsePrePlain } from './time';

export interface ChatMessage {
	/** The element with data-id. */
	element: Element;
	/** ID of WhatsApp; only its hash leaves the browser. */
	id: string;
	text: string;
	sender: string;
	chat: string;
	/** Time in ms, null when WhatsApp's format is unknown. */
	time: number | null;
	sentAt: string | null;
	/** Written by the user (IDs of WhatsApp start with "true_"). */
	outgoing: boolean;
}

/** How the page looks: signed in and understood, still loading or signed out, or unknown. */
export type PageState = 'ok' | 'waiting' | 'unknown';

/** Longest text taken from one message, as the inbox stores it. */
export const TEXT_MAX = 100_000;

/** No-break spaces (U+00A0) of WhatsApp become normal spaces. */
const NO_BREAK_SPACE = new RegExp(String.fromCharCode(0xa0), 'g');

function first(root: ParentNode, selectors: readonly string[]): Element | null {
	for (const selector of selectors) {
		const found = root.querySelector(selector);
		if (found !== null) return found;
	}
	return null;
}

/** Name of the open chat, '' without one. */
export function chatTitle(root: ParentNode): string {
	const element = first(root, SELECTORS.chatTitle);
	return (element?.getAttribute('title') ?? element?.textContent ?? '').trim();
}

/**
 * Text of an element as the user reads it: text, emoji pictures by their alt text, line breaks;
 * without buttons inside the text ("Mehr anzeigen") and without the own elements.
 */
export function textOf(element: Element): string {
	const parts: string[] = [];
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			parts.push(node.nodeValue ?? '');
			return;
		}
		if (!(node instanceof Element)) return;
		if (node.hasAttribute(OWN_ATTRIBUTE) || node.matches(SELECTORS.notText)) return;
		const tag = node.tagName.toLowerCase();
		if (tag === 'br') {
			parts.push('\n');
			return;
		}
		if (tag === 'img') {
			parts.push(node.getAttribute('alt') ?? '');
			return;
		}
		for (const child of Array.from(node.childNodes)) walk(child);
	};
	walk(element);
	return parts.join('').replace(NO_BREAK_SPACE, ' ').trim().slice(0, TEXT_MAX);
}

/** The element with data-id of every message in the open chat that has a text block. */
export function messageElements(root: ParentNode): Element[] {
	const found: Element[] = [];
	for (const row of Array.from(root.querySelectorAll(SELECTORS.row))) {
		const message = row.matches(SELECTORS.message) ? row : row.querySelector(SELECTORS.message);
		if (message !== null && message.querySelector(SELECTORS.textBlock) !== null) {
			found.push(message);
		}
	}
	return found;
}

/** A message of the open chat, or null for one without ID or text (media only). */
export function readMessage(element: Element, chat: string, locale: string): ChatMessage | null {
	const id = element.getAttribute(ID_ATTRIBUTE) ?? '';
	const block = element.querySelector(SELECTORS.textBlock);
	if (id === '' || block === null) return null;
	const textElement = first(block, SELECTORS.text) ?? block;
	const text = textOf(textElement);
	if (text === '') return null;
	const pre = parsePrePlain(block.getAttribute(PRE_PLAIN_ATTRIBUTE), locale);
	return {
		element,
		id,
		text,
		sender: pre.sender,
		chat,
		time: pre.time,
		sentAt: pre.sentAt,
		outgoing: id.startsWith('true_')
	};
}

/**
 * State of the page. "ok": the chat list is there, and the open chat (if any) has rows the
 * extension understands. "waiting": the page loads or shows the sign-in. "unknown": the page is
 * there but looks different; the extension then does nothing and asks for an update.
 * `settledMs`: how long the page had to load; before 30 s a page without chat list is waiting.
 */
export function pageState(root: ParentNode, settledMs: number): PageState {
	if (root.querySelector(SELECTORS.app) === null) return settledMs < 30_000 ? 'waiting' : 'unknown';
	const rows = Array.from(root.querySelectorAll(SELECTORS.row));
	if (rows.length > 0) {
		const understood = rows.some(
			(row) => row.matches(SELECTORS.message) || row.querySelector(SELECTORS.message) !== null
		);
		return understood ? 'ok' : 'unknown';
	}
	if (root.querySelector(SELECTORS.chatList) !== null) return 'ok';
	if (root.querySelector(SELECTORS.signIn) !== null || settledMs < 30_000) return 'waiting';
	return 'unknown';
}
