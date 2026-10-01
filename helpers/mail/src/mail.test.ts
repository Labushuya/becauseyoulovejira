// A mail from the mailbox gives the same draft as the same mail dropped as .eml file (ADR-0017
// section 2), with the parser limits and the keyword matching of the web app (ADR-0020). A mail
// with alternative parts, an inline image and an attachment guards the update to postal-mime 4.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import PostalMime, { decodeWords } from 'postal-mime';
import { describe, expect, it } from 'vitest';
import {
	MAIL_PARSER_OPTIONS,
	mailMatchTexts,
	mailToDraft,
	type ParsedMail
} from '../../../web/src/lib/domain/inbox-mail';
import { ingestDraft, keywordOf, parseMail } from './mail';
import { fakeMail } from '../test/fake-imap';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/eml');

describe('mail from the mailbox', () => {
	it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.eml')))(
		'reads %s like the web app, only with channel "mail"',
		async (name) => {
			const source = readFileSync(join(FIXTURES, name));
			const { matchTexts, ...helper } = await parseMail(new Uint8Array(source));
			const parsed = (await PostalMime.parse(source, MAIL_PARSER_OPTIONS)) as ParsedMail;
			expect(helper).toEqual({ ...mailToDraft(parsed, 'eml'), channel: 'mail' });
			expect(matchTexts).toEqual(mailMatchTexts(parsed, decodeWords));
		}
	);

	it('reads a mail with alternative parts, inline image and attachment with umlauts (BYL-E6-941)', async () => {
		const lf = readFileSync(join(FIXTURES, 'alternative-inline-attachment.eml'), 'latin1');
		const expected = {
			channel: 'mail',
			kind: 'mail',
			title: 'Prüfbericht für März',
			body: 'Hallo Anna,\n\nanbei der Prüfbericht für März.\n\nViele Grüße\nJürgen\n\n_2 Anhänge, nur in der Originaldatei._',
			sourceRef: '<alternative.inline.attachment@example.com>',
			sourceDate: '2026-10-12 12:30:00.000Z',
			sourceMeta: {
				from: 'Jürgen Müller <juergen@example.com>',
				to: 'Anna Beispiel <anna@example.com>',
				attachments: 2
			},
			matchTexts: ['Anna Beispiel <anna@example.com>', 'Hallo Anna,\n\nanbei der Prüfbericht für März.']
		};
		for (const source of [lf, lf.replace(/\r?\n/g, '\r\n')]) {
			expect(await parseMail(new TextEncoder().encode(source))).toEqual(expected);
		}
	});

	it('matches keywords in the subject and, on request, in the whole text', async () => {
		const draft = await parseMail(
			new TextEncoder().encode(
				fakeMail({ subject: 'Hallo', body: `${'x '.repeat(3000)}Rechnung anbei`, messageId: '<a@b>' })
			)
		);
		expect(draft.body?.indexOf('Rechnung')).toBeGreaterThan(5000);
		expect(keywordOf(draft, ['rechnung'], false)).toBe('');
		expect(keywordOf(draft, ['rechnung'], true)).toBe('rechnung');
		expect(keywordOf({ title: 'TODO prüfen', body: '' }, ['pruefen', 'todo'], false)).toBe('pruefen');
	});

	it('searches To, Cc, Reply-To, List-Id, Organization and the HTML part with match_body (full inbox)', async () => {
		const source = [
			'From: Bert Beispiel <bert@example.com>',
			'To: Projekt-X Team <team@example.com>',
			'Cc: =?UTF-8?Q?J=C3=BCrgen_Pr=C3=BCfer?= <juergen@example.com>',
			'Reply-To: antwort@europa-go.example',
			'List-Id: =?UTF-8?Q?Vereinsliste_M=C3=BCnchen?= <liste.example.com>',
			'Organization: Musterverein e. V.',
			'Subject: Rundbrief',
			'Message-ID: <multi@example.com>',
			'MIME-Version: 1.0',
			'Content-Type: multipart/alternative; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain; charset=UTF-8',
			'',
			'Nur der Textteil.',
			'--b',
			'Content-Type: text/html; charset=UTF-8',
			'',
			'<html><body><span style="display:none">Vorschau: bitte erledigen</span><p>HTML-Teil</p></body></html>',
			'--b--',
			''
		].join('\r\n');
		const draft = await parseMail(new TextEncoder().encode(source));
		expect(draft.body).toBe('Nur der Textteil.');
		expect(draft.matchTexts).toEqual([
			'Projekt-X Team <team@example.com>',
			'Jürgen Prüfer <juergen@example.com>',
			'antwort@europa-go.example',
			'Vorschau: bitte erledigen\nHTML-Teil',
			'Vereinsliste München <liste.example.com>',
			'Musterverein e. V.'
		]);
		for (const keyword of ['projekt-x', 'prüfer', 'europa-go', 'erledigen', 'munchen', 'musterverein']) {
			expect(keywordOf(draft, [keyword], true), keyword).toBe(keyword);
			expect(keywordOf(draft, [keyword], false), keyword).toBe('');
		}
		expect(ingestDraft(draft, 'abcdefghij12345', 'auto').match_texts).toEqual(draft.matchTexts);
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
			source_meta: { from: 'Bert Beispiel <bert@example.com>', to: 'anna@web.de' },
			match_texts: ['anna@web.de']
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
