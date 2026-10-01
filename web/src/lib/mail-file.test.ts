// Mail files (E4 plan, package 8): type and size checks, parsing with the file as original and
// refusal of crafted mails; calendar files (package 14) are recognised by name or type. The import
// with its selection view is tested in stores/mail-import.test.ts (package 21). A mail with
// alternative parts, an inline image and an attachment with umlauts in the names guards the
// update to postal-mime 4 (BYL-E6-940).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import {
	MAIL_PARSER_OPTIONS,
	MAIL_PARTIAL_BYTES,
	ORIGINAL_OMITTED_NOTE
} from './domain/inbox-mail';
import {
	EML_MAX_BYTES,
	NOT_EML_MESSAGE,
	UNREADABLE_MESSAGE,
	isMailFile,
	readMailFile
} from './mail-file';
import { isCalendarFile } from './calendar-file';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/eml');

function fixture(name: string, type = 'message/rfc822'): File {
	return new File([readFileSync(join(FIXTURES, name))], name, { type });
}

describe('readMailFile', () => {
	it('recognises mail files by name or type', () => {
		expect(isMailFile({ name: 'a.EML', type: '' })).toBe(true);
		expect(isMailFile({ name: 'mail', type: 'message/rfc822' })).toBe(true);
		expect(isMailFile({ name: 'a.txt', type: 'text/plain' })).toBe(false);
	});

	it('reads a mail with the file as original', async () => {
		const file = fixture('utf8-plain.eml', '');
		const result = await readMailFile(file);
		expect(result).toMatchObject({
			ok: true,
			draft: { channel: 'eml', kind: 'mail', title: 'Grüße aus Köln', original: file }
		});
	});

	it('refuses other files and keeps the file of a mail of exactly 25 MB', async () => {
		expect(EML_MAX_BYTES).toBe(25 * 1024 * 1024);
		expect(await readMailFile(new File(['x'], 'bild.png', { type: 'image/png' }))).toEqual({
			ok: false,
			message: NOT_EML_MESSAGE
		});
		const head = 'Subject: Grenze\r\n\r\n';
		const limit = new File([head, 'a'.repeat(EML_MAX_BYTES - head.length)], 'grenze.eml');
		expect(limit.size).toBe(EML_MAX_BYTES);
		const result = await readMailFile(limit);
		expect(result.ok && result.draft.original).toBe(limit);
	});

	it('reads the beginning of a mail over 25 MB and keeps it without the file (ADR-0031)', async () => {
		const head = [
			'From: Anna Beispiel <anna@example.com>',
			'Subject: Fotos vom Fest',
			'Message-ID: <gross@example.com>',
			'Date: Fri, 25 Sep 2026 10:00:00 +0200',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Hier die Fotos.',
			'--b',
			'Content-Type: application/octet-stream',
			'Content-Transfer-Encoding: base64',
			'',
			''
		].join('\r\n');
		const big = new File([head, 'A'.repeat(EML_MAX_BYTES)], 'gross.eml');
		const read: number[] = [];
		const slice = big.slice.bind(big);
		big.slice = (start?: number, end?: number) => {
			read.push(end ?? big.size);
			return slice(start, end);
		};
		const result = await readMailFile(big);
		expect(read).toEqual([MAIL_PARTIAL_BYTES]);
		expect(result).toMatchObject({
			ok: true,
			draft: {
				channel: 'eml',
				title: 'Fotos vom Fest',
				sourceRef: '<gross@example.com>',
				sourceMeta: {
					from: 'Anna Beispiel <anna@example.com>',
					original_omitted: 'too_large',
					original_size: big.size
				}
			}
		});
		if (!result.ok) throw new Error('read');
		expect(result.draft.original).toBeUndefined();
		expect(result.draft.body).toBe(`Hier die Fotos.\n\n${ORIGINAL_OMITTED_NOTE}`);
		expect(result.draft.sourceMeta).not.toHaveProperty('attachments');
	});

	it('refuses a crafted mail with too deeply nested parts', async () => {
		const depth = 60;
		const parts: string[] = ['Subject: tief', 'MIME-Version: 1.0'];
		for (let level = 0; level < depth; level++) {
			parts.push(`Content-Type: multipart/mixed; boundary="b${level}"`, '', `--b${level}`);
		}
		parts.push('Content-Type: text/plain', '', 'innen');
		for (let level = depth - 1; level >= 0; level--) parts.push(`--b${level}--`);
		const file = new File([parts.join('\r\n')], 'tief.eml');
		expect(await readMailFile(file)).toEqual({ ok: false, message: UNREADABLE_MESSAGE });
	});
});

describe('mail with alternative parts, inline image and attachment (BYL-E6-940)', () => {
	const NAME = 'alternative-inline-attachment.eml';
	const DRAFT = {
		channel: 'eml',
		kind: 'mail',
		title: 'Prüfbericht für März',
		body: 'Hallo Anna,\n\nanbei der Prüfbericht für März.\n\nViele Grüße\nJürgen\n\n_2 Anhänge, nur in der Originaldatei._',
		sourceRef: '<alternative.inline.attachment@example.com>',
		sourceDate: '2026-10-12 12:30:00.000Z',
		sourceMeta: {
			from: 'Jürgen Müller <juergen@example.com>',
			to: 'Anna Beispiel <anna@example.com>',
			attachments: 2
		}
	};

	it('gives title, text, sender, date, Message-ID and attachments, with the file as original', async () => {
		const file = fixture(NAME, '');
		const result = await readMailFile(file);
		if (!result.ok) throw new Error(result.message);
		const { original, ...fields } = result.draft;
		expect(fields).toEqual(DRAFT);
		expect(original).toBe(file);
		expect(result.matchTexts).toEqual([
			'Anna Beispiel <anna@example.com>',
			'Hallo Anna,\n\nanbei der Prüfbericht für März.'
		]);
	});

	it('reads the same mail with CRLF line ends, as it comes from a mailbox', async () => {
		const crlf = readFileSync(join(FIXTURES, NAME), 'latin1').replace(/\r?\n/g, '\r\n');
		const file = new File([crlf], NAME);
		const result = await readMailFile(file);
		if (!result.ok) throw new Error(result.message);
		expect({ ...result.draft, original: undefined }).toEqual(DRAFT);
		expect(result.draft.original).toBe(file);
	});

	it('names the attachments with umlauts, their types, disposition and content', async () => {
		const email = await PostalMime.parse(readFileSync(join(FIXTURES, NAME)), MAIL_PARSER_OPTIONS);
		const bytes = (content: unknown) =>
			content instanceof ArrayBuffer ? Array.from(new Uint8Array(content)) : content;
		expect(
			email.attachments.map(({ content, ...attachment }) => ({
				...attachment,
				content: bytes(content)
			}))
		).toEqual([
			{
				filename: 'Grüße Logo.png',
				mimeType: 'image/png',
				disposition: 'inline',
				related: true,
				contentId: '<logo.inline@example.com>',
				content: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
			},
			{
				filename: 'Prüfbericht März.pdf',
				mimeType: 'application/pdf',
				disposition: 'attachment',
				content: Array.from(new TextEncoder().encode('%PDF-1.4 erfunden'))
			}
		]);
		expect(email.text?.trim()).toBe(
			'Hallo Anna,\n\nanbei der Prüfbericht für März.\n\nViele Grüße\nJürgen'
		);
		expect(email.html).toContain('<img src="cid:logo.inline@example.com" alt="Logo">');
	});
});

describe('calendar files (E4 plan, package 14)', () => {
	it('recognises calendar files by name or type', () => {
		expect(isCalendarFile({ name: 'Termin.ICS', type: '' })).toBe(true);
		expect(isCalendarFile({ name: 'export', type: 'text/calendar' })).toBe(true);
		expect(isCalendarFile({ name: 'a.eml', type: 'message/rfc822' })).toBe(false);
	});
});
