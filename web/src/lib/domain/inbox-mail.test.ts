// Mail to inbox draft (E4 plan, package 8; ADR-0017 section 2): the fixture table through
// postal-mime and mailToDraft (UTF-8, ISO-8859-1 with quoted-printable, Windows-1252 with base64,
// HTML only, without Message-ID, attachments, without subject), and the pure helpers.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import {
	NO_SUBJECT,
	SOURCE_REF_MAX_LENGTH,
	formatAddress,
	mailDate,
	mailMatchTexts,
	mailText,
	mailToDraft
} from './inbox-mail';
import { MAIL_EXTRA_TEXTS_MAX } from './keywords';

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/eml');

async function draftOf(name: string) {
	const email = await PostalMime.parse(readFileSync(join(FIXTURES, name)));
	return mailToDraft(email);
}

describe('mailToDraft with the fixtures', () => {
	it('reads a UTF-8 mail with encoded subject and several recipients', async () => {
		expect(await draftOf('utf8-plain.eml')).toEqual({
			channel: 'eml',
			kind: 'mail',
			title: 'Grüße aus Köln',
			body: 'Hallo Ben,\n\nviele Grüße aus Köln – bis Freitag!\nAnna',
			sourceRef: '<Fixture.UTF8.1@Example.com>',
			sourceDate: '2026-09-25 08:15:00.000Z',
			sourceMeta: {
				from: 'Anna Beispiel <anna@example.com>',
				to: 'Ben Muster <ben@example.org>, carla@example.net',
				cc: 'Team, Haus <team@example.org>'
			}
		});
	});

	it('decodes ISO-8859-1 with quoted-printable in header and text', async () => {
		const draft = await draftOf('latin1-qp.eml');
		expect(draft.title).toBe('Straßenfest am Südplatz');
		expect(draft.body).toBe(
			'Schöne Grüße, das Fest beginnt um 15 Uhr. Eine sehr lange Zeile, die umbrochen wurde.'
		);
		expect(draft.sourceMeta).toEqual({
			from: 'Jürgen Müller <juergen@example.com>',
			to: 'anna@example.com'
		});
		expect(draft.sourceDate).toBe('2026-10-05 08:00:00.000Z');
	});

	it('decodes Windows-1252 with base64, including € and German quotes', async () => {
		const draft = await draftOf('cp1252-base64.eml');
		expect(draft.title).toBe('Rechnung €');
		expect(draft.body).toBe('Rechnung: 12,50 € für den „Einkauf“.');
	});

	it('turns an HTML-only mail into text without script, style, images or unsafe links', async () => {
		const draft = await draftOf('html-only.eml');
		expect(draft.body).toBe(
			[
				'Angebot',
				'',
				'Äpfel & Birnen für 2 € – nur heute.',
				'',
				'Artikel | Preis',
				'Brot | 3 €',
				'',
				'Zum Angebot (https://shop.example.com/angebot?a=1&b=2) oder',
				'hier.',
				'',
				'- Eins',
				'- Zwei'
			].join('\n')
		);
		expect(draft.body).not.toMatch(/alert|tracker|color|Titel|Kommentar|javascript/);
		expect(draft.sourceMeta).toMatchObject({ html_only: true });
	});

	it('keeps sender, date and subject for the duplicate key of a mail without Message-ID', async () => {
		const draft = await draftOf('no-message-id.eml');
		expect(draft).toMatchObject({
			title: 'Mitgliederversammlung',
			sourceRef: '',
			sourceDate: '2026-10-08 17:00:00.000Z',
			sourceMeta: { from: 'Verein <info@example.org>' }
		});
	});

	it('only counts attachments and names them in the text', async () => {
		const draft = await draftOf('attachments.eml');
		expect(draft.body).toBe('Anbei die Unterlagen.\n\n_2 Anhänge, nur in der Originaldatei._');
		expect(draft.sourceMeta).toMatchObject({ attachments: 2 });
	});

	it('names a mail without subject and without readable date', async () => {
		const draft = await draftOf('no-subject.eml');
		expect(draft.title).toBe(NO_SUBJECT);
		expect(draft.sourceDate).toBeNull();
		expect(draft.sourceMeta).toEqual({ from: 'unbekannt@example.com' });
	});
});

describe('mail helpers', () => {
	it('formats mailboxes and groups', () => {
		expect(formatAddress({ name: 'Anna', address: 'anna@example.com' })).toBe(
			'Anna <anna@example.com>'
		);
		expect(formatAddress({ name: '', address: 'a@b.de' })).toBe('a@b.de');
		expect(formatAddress({ name: 'a@b.de', address: 'a@b.de' })).toBe('a@b.de');
		expect(
			formatAddress({
				name: 'Team',
				group: [
					{ name: 'A', address: 'a@b.de' },
					{ name: '', address: 'c@d.de' }
				]
			})
		).toBe('Team: A <a@b.de>, c@d.de');
	});

	it('reads dates or gives null', () => {
		expect(mailDate('2026-09-25T08:15:00.000Z')).toBe('2026-09-25 08:15:00.000Z');
		expect(mailDate('Fri, 25 Sep 2026 10:15:00 +0200')).toBe('2026-09-25 08:15:00.000Z');
		expect(mailDate('irgendwann')).toBeNull();
		expect(mailDate(undefined)).toBeNull();
	});

	it('prefers the plain text part', () => {
		expect(mailText({ text: '  Text\r\n ', html: '<p>HTML</p>' })).toBe('Text');
		expect(mailText({ text: ' ', html: '<p>HTML</p>' })).toBe('HTML');
		expect(mailText({})).toBe('');
	});

	it('cuts title, text, recipients and the Message-ID to the limits', () => {
		const draft = mailToDraft({
			subject: 's'.repeat(300),
			text: 't'.repeat(100_500),
			messageId: `<${'m'.repeat(600)}@x>`,
			to: Array.from({ length: 200 }, (_, index) => ({
				name: `Person ${index}`,
				address: `p${index}@example.com`
			})),
			attachments: []
		});
		expect(draft.title).toHaveLength(200);
		expect(draft.body).toHaveLength(100_000);
		expect(draft.sourceRef).toHaveLength(SOURCE_REF_MAX_LENGTH);
		expect(String(draft.sourceMeta?.to).length).toBeLessThanOrEqual(2000);
		expect(mailToDraft({ attachments: [] }, 'mail').channel).toBe('mail');
	});
});

describe('mailMatchTexts (full inbox, ADR-0020 addendum 2)', () => {
	it('gives To, Cc, Reply-To, Sender, the HTML part and the named headers as separate texts', () => {
		const texts = mailMatchTexts(
			{
				to: [{ name: 'Anna', address: 'anna@example.com' }],
				cc: [{ name: '', address: 'cc@example.com' }],
				replyTo: [{ name: 'Antwort', address: 'antwort@example.com' }],
				sender: { name: 'Versand', address: 'versand@example.com' },
				headers: [
					{ key: 'subject', value: 'nicht hier' },
					{ key: 'list-id', value: '=?UTF-8?Q?M=C3=BCnchen?= <l.example.com>' },
					{ key: 'organization', value: '  Verein\r\n e. V. ' }
				],
				text: 'Text',
				html: '<p>Vorschau &amp; HTML</p>'
			},
			(value) => value.replace('=?UTF-8?Q?M=C3=BCnchen?=', 'München')
		);
		expect(texts).toEqual([
			'Anna <anna@example.com>',
			'cc@example.com',
			'Antwort <antwort@example.com>',
			'Versand <versand@example.com>',
			'Vorschau & HTML',
			'München <l.example.com>',
			'Verein e. V.'
		]);
	});

	it('leaves out the HTML part of an HTML-only mail (it is the text already) and empty parts', () => {
		expect(mailMatchTexts({ html: '<p>HTML</p>' })).toEqual([]);
		expect(
			mailMatchTexts({ text: ' ', html: '<p>HTML</p>', headers: [{ key: 'list-id', value: ' ' }] })
		).toEqual([]);
	});

	it('keeps at most MAIL_EXTRA_TEXTS_MAX texts, the HTML part first of the headers', () => {
		const texts = mailMatchTexts({
			text: 'Text',
			html: '<p>HTML</p>',
			headers: Array.from({ length: 20 }, (_, index) => ({
				key: 'list-id',
				value: `liste-${index}`
			}))
		});
		expect(texts).toHaveLength(MAIL_EXTRA_TEXTS_MAX);
		expect(texts[0]).toBe('HTML');
	});
});
