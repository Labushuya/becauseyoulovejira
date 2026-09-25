// Bookmarklet (E4 plan, package 7): code generation and encoding (special characters, lengths),
// refusal of javascript:, data: and file: addresses, round trip of the parameters through the
// code, the capture form and the login redirect.

import { describe, expect, it, vi } from 'vitest';
import { loginUrlFor, safeRedirect } from '../guard';
import {
	BOOKMARKLET_PARAMS,
	SELECTION_MAX_LENGTH,
	bookmarkletCode,
	bookmarkletValues
} from './bookmarklet';

const CAPTURE = 'http://127.0.0.1:8090/eingang/neu';

/** Runs the bookmarklet on a fake page and returns the address it opens. */
function run(
	code: string,
	page: { href: string; title: string; selection: string }
): { url: string; target: string; features: string } {
	expect(code.startsWith('javascript:')).toBe(true);
	const source = decodeURIComponent(code.slice('javascript:'.length));
	const open = vi.fn();
	const fakeWindow = { getSelection: () => ({ toString: () => page.selection }), open };
	new Function('window', 'location', 'document', source)(
		fakeWindow,
		{ href: page.href },
		{ title: page.title }
	);
	expect(open).toHaveBeenCalledOnce();
	const [url, target, features] = open.mock.calls[0] as [string, string, string];
	return { url, target, features };
}

describe('bookmarkletCode', () => {
	it('opens the capture form of the app in a new tab without opener', () => {
		const opened = run(bookmarkletCode(CAPTURE), {
			href: 'https://example.com/a?b=1',
			title: 'Seite',
			selection: ''
		});
		expect(opened.url).toBe(
			`${CAPTURE}?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&titel=Seite&auswahl=`
		);
		expect(opened.target).toBe('_blank');
		expect(opened.features).toBe('noopener');
	});

	it('keeps special characters of the page through the round trip', () => {
		const page = {
			href: 'https://example.com/pfad/%C3%A4%20%C3%B6?q=a&b=c#teil',
			title: 'Äpfel & „Birnen“ <b> \'x\' "y" 😀',
			selection: 'Zeile 1\nZeile 2 & %20 #hash'
		};
		const opened = new URL(run(bookmarkletCode(CAPTURE), page).url);
		expect(opened.origin + opened.pathname).toBe(CAPTURE);
		expect(bookmarkletValues(opened.searchParams)).toEqual({
			url: page.href,
			refusedUrl: false,
			title: page.title,
			selection: page.selection
		});
	});

	it('cuts the selection to 1 500 characters in the page', () => {
		const opened = new URL(
			run(bookmarkletCode(CAPTURE), {
				href: 'https://example.com/',
				title: 't',
				selection: 'x'.repeat(5000)
			}).url
		);
		expect(opened.searchParams.get(BOOKMARKLET_PARAMS.selection)).toHaveLength(
			SELECTION_MAX_LENGTH
		);
	});

	it('embeds the address of the app safely and only for http(s)', () => {
		const code = bookmarkletCode("http://127.0.0.1:8090/base'x/eingang/neu");
		const opened = run(code, { href: 'https://example.com/', title: '', selection: '' });
		expect(opened.url.startsWith('http://127.0.0.1:8090/base')).toBe(true);
		expect(() => bookmarkletCode('javascript:alert(1)')).toThrow(RangeError);
		expect(() => bookmarkletCode('file:///C:/app/eingang/neu')).toThrow(RangeError);
	});
});

describe('bookmarkletValues', () => {
	const read = (query: string) => bookmarkletValues(new URLSearchParams(query));

	it('is null without any of the parameters', () => {
		expect(read('')).toBeNull();
		expect(read('vorlage=anruf')).toBeNull();
	});

	it.each([
		'javascript:alert(1)',
		'JAVASCRIPT:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'file:///C:/geheim.txt',
		'ftp://example.com/',
		'//example.com/',
		'/eingang',
		'http://',
		'https://exa mple.com/'
	])('refuses the address %s', (address) => {
		expect(read(new URLSearchParams({ url: address, titel: 'T' }).toString())).toEqual({
			url: null,
			refusedUrl: true,
			title: 'T',
			selection: ''
		});
	});

	it('trims and cuts title and selection again, and ignores repeated values', () => {
		const values = read(
			new URLSearchParams({
				url: ' https://example.com/ ',
				titel: `  ${'t'.repeat(300)}  `,
				auswahl: `  ${'s'.repeat(2000)} `
			}).toString()
		);
		expect(values?.url).toBe('https://example.com/');
		expect(values?.title).toHaveLength(200);
		expect(values?.selection).toHaveLength(SELECTION_MAX_LENGTH);
		expect(read('url=https://a.de/&url=https://b.de/')).toMatchObject({
			url: null,
			refusedUrl: false
		});
	});

	it('survives the way through the login and back', () => {
		const page = new URL(
			`${CAPTURE}?${new URLSearchParams({ url: 'https://example.com/?a=1&b=2', titel: 'Ä & B', auswahl: 'x#y' })}`
		);
		const login = new URL(loginUrlFor(page), page.origin);
		const back = new URL(
			safeRedirect(login.searchParams.get('redirect'), page.origin),
			page.origin
		);
		expect(bookmarkletValues(back.searchParams)).toEqual(bookmarkletValues(page.searchParams));
		expect(back.pathname).toBe('/eingang/neu');
	});
});
