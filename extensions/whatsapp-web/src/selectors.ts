// Every selector of WhatsApp Web in one place (ADR-0038 §3). WhatsApp changes its markup without
// notice; when it does, only this module needs an update, and the tests with the hand-built pages
// in src/fixtures show what the extension expects. Stable attributes come first (IDs of the
// layout, data-id, data-pre-plain-text, roles, dir, title); CSS classes only as a fallback.

export const SELECTORS = {
	/** Root of the web app. */
	app: '#app',
	/** List of chats: WhatsApp Web is signed in and loaded. */
	chatList: '#pane-side',
	/** The open chat. */
	main: '#main',
	/** QR code of the sign-in page. */
	signIn: '[data-ref], canvas[aria-label]',
	/** Name of the open chat in its header (the title holds the whole name). */
	chatTitle: ['#main header span[dir="auto"][title]', '#main header span[title]'],
	/** Rows of the message list of the open chat. */
	row: '#main [role="row"]',
	/** A message with its ID (e.g. "false_…@c.us_3EB0…"). */
	message: '[data-id]',
	/** Text block of a message with "[14:32, 28.9.2026] Anna: " as time and sender. */
	textBlock: '[data-pre-plain-text]',
	/** The text inside the text block: the outer span with a direction, else the class. */
	text: ['span[dir]', '.selectable-text'],
	/** Parts of a text that are no text of the message ("Mehr anzeigen" of long messages). */
	notText: '[role="button"], button'
} as const;

/** Attribute of the ID and of time and sender. */
export const ID_ATTRIBUTE = 'data-id';
export const PRE_PLAIN_ATTRIBUTE = 'data-pre-plain-text';

/** Marker of the own elements of the extension; nothing else is added to the page. */
export const OWN_ATTRIBUTE = 'data-byl-wa';
