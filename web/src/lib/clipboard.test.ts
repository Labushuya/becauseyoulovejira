// Clipboard of the inbox (E4 plan, package 6): reading with refusal and missing API, drafts with
// 1, 2 and 101 lines; writing for the code blocks of the guides (ADR-0026 section 6, EH-4).

import { describe, expect, it, vi } from 'vitest';
import {
	CLIPBOARD_DENIED_MESSAGE,
	CLIPBOARD_EMPTY_MESSAGE,
	CLIPBOARD_MAX_LINES,
	CLIPBOARD_TOO_MANY_MESSAGE,
	clipboardDrafts,
	pastedText,
	readClipboardText,
	textLines,
	writeClipboardText
} from './clipboard';

describe('writeClipboardText', () => {
	it('writes the text and answers true', async () => {
		const writeText = vi.fn(async () => undefined);
		expect(await writeClipboardText('setx X "1"', { clipboard: { writeText } })).toBe(true);
		expect(writeText).toHaveBeenCalledWith('setx X "1"');
	});

	it('answers false without the API or when the browser refuses', async () => {
		expect(await writeClipboardText('x', {})).toBe(false);
		expect(await writeClipboardText('x', undefined)).toBe(false);
		const writeText = vi.fn(async () => {
			throw new Error('denied');
		});
		expect(await writeClipboardText('x', { clipboard: { writeText } })).toBe(false);
	});
});

describe('readClipboardText', () => {
	it('returns the text', async () => {
		const readText = vi.fn(async () => 'Milch\nBrot');
		expect(await readClipboardText({ clipboard: { readText } })).toEqual({
			ok: true,
			text: 'Milch\nBrot'
		});
	});

	it('names Ctrl+V when the browser refuses or has no API', async () => {
		const refused = {
			clipboard: {
				readText: vi.fn(async () => {
					throw new DOMException('denied', 'NotAllowedError');
				})
			}
		};
		expect(await readClipboardText(refused)).toEqual({
			ok: false,
			message: CLIPBOARD_DENIED_MESSAGE
		});
		expect(await readClipboardText({})).toEqual({ ok: false, message: CLIPBOARD_DENIED_MESSAGE });
		expect(await readClipboardText({ clipboard: {} })).toEqual({
			ok: false,
			message: CLIPBOARD_DENIED_MESSAGE
		});
		expect(await readClipboardText(undefined)).toEqual({
			ok: false,
			message: CLIPBOARD_DENIED_MESSAGE
		});
		expect(CLIPBOARD_DENIED_MESSAGE).toMatch(/Strg\+V/);
	});

	it('refuses an empty text', async () => {
		expect(await readClipboardText({ clipboard: { readText: async () => ' \n ' } })).toEqual({
			ok: false,
			message: CLIPBOARD_EMPTY_MESSAGE
		});
	});
});

describe('clipboardDrafts', () => {
	it('makes one entry of one line', () => {
		expect(clipboardDrafts('  Milch   kaufen  ')).toEqual({
			ok: true,
			drafts: [{ channel: 'clipboard', kind: 'todo', title: 'Milch kaufen', body: '' }]
		});
	});

	it('takes the first line as title and the rest as text', () => {
		expect(clipboardDrafts('\n\nBrief an Amt\r\nAktenzeichen 12\n\nbis Freitag\n')).toEqual({
			ok: true,
			drafts: [
				{
					channel: 'clipboard',
					kind: 'todo',
					title: 'Brief an Amt',
					body: 'Aktenzeichen 12\n\nbis Freitag'
				}
			]
		});
	});

	it('makes one entry per non-empty line on request', () => {
		const result = clipboardDrafts('Milch\n\n Brot \n', { eachLine: true });
		expect(result).toEqual({
			ok: true,
			drafts: [
				{ channel: 'clipboard', kind: 'todo', title: 'Milch', body: '' },
				{ channel: 'clipboard', kind: 'todo', title: 'Brot', body: '' }
			]
		});
	});

	it('takes 100 lines and refuses 101', () => {
		const lines = (count: number) =>
			Array.from({ length: count }, (_, index) => `Zeile ${index + 1}`).join('\n');
		const hundred = clipboardDrafts(lines(CLIPBOARD_MAX_LINES), { eachLine: true });
		expect(hundred.ok && hundred.drafts).toHaveLength(100);
		expect(clipboardDrafts(lines(101), { eachLine: true })).toEqual({
			ok: false,
			message: CLIPBOARD_TOO_MANY_MESSAGE
		});
		// As one entry, 101 lines are fine: title and text.
		const single = clipboardDrafts(lines(101));
		expect(single.ok && single.drafts).toHaveLength(1);
	});

	it('refuses an empty text and cuts long titles', () => {
		expect(clipboardDrafts(' \n\t')).toEqual({ ok: false, message: CLIPBOARD_EMPTY_MESSAGE });
		const long = clipboardDrafts('z'.repeat(300));
		expect(long.ok && long.drafts[0]?.title).toHaveLength(200);
		expect(textLines('a\r\nb\rc\n\n')).toEqual(['a', 'b', 'c']);
	});
});

describe('pastedText (Ctrl+V in the inbox view)', () => {
	const data = (text: string) => ({
		getData: (type: string) => (type === 'text/plain' ? text : '')
	});

	it('takes the text of a paste on the page', () => {
		document.body.innerHTML = '<main><a href="/x">x</a></main>';
		const target = document.querySelector('a');
		expect(pastedText({ target, clipboardData: data('Milch') as DataTransfer })).toBe('Milch');
	});

	it('leaves pastes into fields and dialogs and empty texts alone', () => {
		document.body.innerHTML = '<input /><dialog open><button>x</button></dialog>';
		expect(
			pastedText({
				target: document.querySelector('input'),
				clipboardData: data('Milch') as DataTransfer
			})
		).toBeNull();
		expect(
			pastedText({
				target: document.querySelector('button'),
				clipboardData: data('Milch') as DataTransfer
			})
		).toBeNull();
		document.body.innerHTML = '<main></main>';
		expect(
			pastedText({
				target: document.querySelector('main'),
				clipboardData: data(' ') as DataTransfer
			})
		).toBeNull();
		expect(pastedText({ target: document.querySelector('main'), clipboardData: null })).toBeNull();
		document.body.innerHTML = '';
	});
});
