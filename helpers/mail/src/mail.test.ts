// A mail from the mailbox gives the same draft as the same mail dropped as .eml file (ADR-0017
// section 2), with the parser limits and the keyword matching of the web app (ADR-0020).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { MAIL_PARSER_OPTIONS, mailToDraft, type ParsedMail } from '../../../web/src/lib/domain/inbox-mail';
import { ingestDraft, keywordOf, parseMail } from './mail';
import { fakeMail } from '../test/fake-imap';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/eml');

describe('mail from the mailbox', () => {
	it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.eml')))(
		'reads %s like the web app, only with channel "mail"',
		async (name) => {
			const source = readFileSync(join(FIXTURES, name));
			const helper = await parseMail(new Uint8Array(source));
			const web = mailToDraft((await PostalMime.parse(source, MAIL_PARSER_OPTIONS)) as ParsedMail, 'eml');
			expect(helper).toEqual({ ...web, channel: 'mail' });
		}
	);

	it('matches keywords in the subject and, on request, in the first 500 characters', async () => {
		const draft = await parseMail(
			new TextEncoder().encode(
				fakeMail({ subject: 'Hallo', body: `${'x '.repeat(200)}Rechnung anbei`, messageId: '<a@b>' })
			)
		);
		expect(keywordOf(draft, ['rechnung'], false)).toBe('');
		expect(keywordOf(draft, ['rechnung'], true)).toBe('rechnung');
		expect(keywordOf({ title: 'TODO prüfen', body: '' }, ['pruefen', 'todo'], false)).toBe('pruefen');
		expect(keywordOf({ title: 'x', body: `${'y'.repeat(500)} todo` }, ['todo'], true)).toBe('');
	});

	it('matches keywords in the sender, name and address, without match_body (package A)', async () => {
		const draft = await parseMail(
			new TextEncoder().encode(
				fakeMail({ subject: 'Angebot', from: 'Europa-Go Reisen <info@europa-go.de>', messageId: '<s@b>' })
			)
		);
		expect(draft.sourceMeta?.from).toBe('Europa-Go Reisen <info@europa-go.de>');
		expect(keywordOf(draft, ['europa-go'], false)).toBe('europa-go');
		expect(keywordOf(draft, ['EUROPA-GO.DE'], false)).toBe('EUROPA-GO.DE');
		expect(keywordOf(draft, ['reisen'], false)).toBe('reisen');
		expect(keywordOf({ title: 'Angebot', body: '' }, ['europa-go'], false)).toBe('');
	});

	it('searches the text of an HTML-only, quoted-printable mail with match_body (package A)', async () => {
		const html = '<html><head><style>p{}</style></head><body><p>Ihre Buchung bei <b>Europa-Go</b>=\r\n.de</p></body></html>';
		const draft = await parseMail(
			new TextEncoder().encode(
				fakeMail({
					subject: 'Angebot',
					body: html,
					messageId: '<h@b>',
					contentType: 'text/html',
					transferEncoding: 'quoted-printable'
				})
			)
		);
		expect(draft.body).toBe('Ihre Buchung bei Europa-Go.de');
		expect(keywordOf(draft, ['europa-go'], true)).toBe('europa-go');
		expect(keywordOf({ ...draft, sourceMeta: {} }, ['europa-go'], false)).toBe('');
	});

	it('sends the fields of the ingest route', async () => {
		const draft = await parseMail(
			new TextEncoder().encode(fakeMail({ subject: 'Todo: Steuer', messageId: '<m1@example.com>' }))
		);
		expect(ingestDraft(draft, 'abcdefghij12345', 'auto')).toEqual({
			connection: 'abcdefghij12345',
			origin: 'auto',
			title: 'Todo: Steuer',
			body: 'Text der Mail.',
			source_ref: '<m1@example.com>',
			source_date: '2026-09-25 08:00:00.000Z',
			source_meta: { from: 'Bert Beispiel <bert@example.com>', to: 'anna@web.de' }
		});
	});

	it('refuses a mail that nests deeper than the limit of the web app', async () => {
		const depth = MAIL_PARSER_OPTIONS.maxNestingDepth + 5;
		const parts: string[] = ['Subject: tief', 'MIME-Version: 1.0'];
		for (let level = 0; level < depth; level++) {
			parts.push(`Content-Type: multipart/mixed; boundary="b${level}"`, '', `--b${level}`);
		}
		parts.push('Content-Type: text/plain', '', 'innen', '');
		await expect(parseMail(new TextEncoder().encode(parts.join('\r\n')))).rejects.toThrow();
	});
});
