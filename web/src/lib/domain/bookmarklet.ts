// Bookmarklet for web links (E4 plan, package 7). Pure: builds the `javascript:` code from the
// address of the app and reads its parameters back. The bookmarklet only opens the capture form
// in a new tab with address, title and selection of the page; nothing is saved before the user
// clicks (no creation by GET, so foreign pages cannot create entries).

import { fitTitle } from './templates';
import { httpUrlOf } from './inbox';

/** The selection of the page is cut to this many characters before it goes into the URL. */
export const SELECTION_MAX_LENGTH = 1500;

/** Query parameters of the capture form that the bookmarklet sets. */
export const BOOKMARKLET_PARAMS = Object.freeze({
	url: 'url',
	title: 'titel',
	selection: 'auswahl'
} as const);

/**
 * `javascript:` code of the bookmarklet for the capture form at `captureUrl` (absolute, e.g.
 * `http://127.0.0.1:8090/eingang/neu`). ES5 without dependencies, so it runs on any page; the
 * address of the app is embedded as JSON string literal.
 */
export function bookmarkletCode(captureUrl: string): string {
	const target = new URL(captureUrl);
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new RangeError(`Not an http(s) address: ${captureUrl}`);
	}
	const base = JSON.stringify(`${target.origin}${target.pathname}`);
	const { url, title, selection } = BOOKMARKLET_PARAMS;
	const body = [
		'(function(){',
		"var s=String(window.getSelection?window.getSelection():'')",
		`.slice(0,${SELECTION_MAX_LENGTH});`,
		`var q='?${url}='+encodeURIComponent(location.href)`,
		`+'&${title}='+encodeURIComponent(document.title)`,
		`+'&${selection}='+encodeURIComponent(s);`,
		`window.open(${base}+q,'_blank','noopener');`,
		'})();'
	].join('');
	// The browser decodes a javascript: address before running it; encoding keeps every character
	// of the embedded address intact.
	return `javascript:${encodeURIComponent(body)}`;
}

/** Values the bookmarklet brought; `url` is null for a missing or refused address. */
export interface BookmarkletValues {
	url: string | null;
	/** The address was given but is not http(s) (javascript:, data:, file: …). */
	refusedUrl: boolean;
	title: string;
	selection: string;
}

function single(params: URLSearchParams, name: string): string {
	const values = params.getAll(name);
	return values.length === 1 ? (values[0] ?? '') : '';
}

/**
 * Values of the bookmarklet in the URL of the capture form, or null if the URL carries none.
 * Only http and https addresses are taken; title and selection are trimmed and cut again, since
 * the URL can be typed by anyone.
 */
export function bookmarkletValues(params: URLSearchParams): BookmarkletValues | null {
	const { url, title, selection } = BOOKMARKLET_PARAMS;
	if (!params.has(url) && !params.has(title) && !params.has(selection)) return null;
	const address = single(params, url);
	const accepted = httpUrlOf(address);
	return {
		url: accepted,
		refusedUrl: address.trim() !== '' && accepted === null,
		title: fitTitle(single(params, title).replace(/\s+/g, ' ').trim()),
		selection: single(params, selection).trim().slice(0, SELECTION_MAX_LENGTH)
	};
}
