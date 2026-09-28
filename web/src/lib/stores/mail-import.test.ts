// Dropped files in two steps (E4 plan, packages 8, 14, 16 and 21; ADR-0020): reading mails,
// calendar previews and chat exports into one selection with the keyword matches chosen at first
// and what is in the inbox already blocked; then saving only the chosen mails and events.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_TOO_LARGE_MESSAGE, ICS_MAX_BYTES } from '$lib/calendar-file';
import type { CalendarPreview, LookupState } from '$lib/data/inbox';
import { DataError } from '$lib/data/errors';
import type { InboxDraft } from '$lib/domain/inbox';
import { EMPTY_IMPORT_KEYWORDS, type ImportKeywords } from '$lib/domain/keywords';
import { restartNeeded } from '$lib/guidance/texts';
import { NOT_EML_MESSAGE, readMailFile } from '$lib/mail-file';
import { readWhatsAppFile } from '$lib/whatsapp-file';
import {
	ONE_CHAT_AT_A_TIME,
	importCounts,
	importSummary,
	preselectedKeys,
	prepareDroppedFiles,
	saveFileSelection,
	type PrepareDeps
} from './mail-import';

const EML = join(import.meta.dirname, '../../../../tests/fixtures/eml');
const CHATS = join(import.meta.dirname, '../../../../tests/fixtures/whatsapp');
const mailFile = (name: string) =>
	new File([readFileSync(join(EML, name))], name, { type: 'message/rfc822' });
const chatFile = (name: string) => new File([readFileSync(join(CHATS, name))], name);
const calendar = (name = 'kalender.ics', size = 10) =>
	new File([new Uint8Array(size)], name, { type: 'text/calendar' });

const KEYWORDS: ImportKeywords = {
	...EMPTY_IMPORT_KEYWORDS,
	eml: { keywords: ['grüße'], matchBody: false },
	ics: { keywords: ['todo'], matchBody: false },
	whatsapp: { keywords: ['milch'], matchBody: false }
};

const PREVIEW: CalendarPreview = {
	skipped: 1,
	items: [
		{
			index: 0,
			kind: 'event',
			title: 'Todo: Steuer',
			sourceDate: '2026-09-30 22:00:00.000Z',
			allDay: true,
			series: false,
			location: '',
			keyword: 'todo',
			state: '',
			message: ''
		},
		{
			index: 1,
			kind: 'event',
			title: 'Chorprobe',
			sourceDate: '2026-10-02 18:00:00.000Z',
			allDay: false,
			series: true,
			location: 'Saal 2',
			keyword: '',
			state: '',
			message: ''
		},
		{
			index: 2,
			kind: 'todo',
			title: 'Todo: Reifen',
			sourceDate: null,
			allDay: false,
			series: false,
			location: '',
			keyword: 'todo',
			state: 'discarded',
			message: 'Schon verworfen.'
		}
	]
};

function deps(overrides: Partial<PrepareDeps> = {}) {
	return {
		read: readMailFile,
		readChat: readWhatsAppFile,
		previewCalendar: vi.fn<PrepareDeps['previewCalendar']>(async () => PREVIEW),
		lookup: vi.fn<PrepareDeps['lookup']>(async (drafts: readonly InboxDraft[]) =>
			drafts.map((): LookupState => ({ state: '', message: '' }))
		),
		keywords: vi.fn<PrepareDeps['keywords']>(async () => KEYWORDS),
		onSessionLost: vi.fn(),
		...overrides
	} satisfies PrepareDeps;
}

describe('prepareDroppedFiles', () => {
	it('offers mails and events with keywords and blocks what is in the inbox', async () => {
		const d = deps({
			lookup: vi.fn(async (drafts: readonly InboxDraft[]) =>
				drafts.map((draft): LookupState =>
					draft.title === 'Rechnung September'
						? { state: 'converted', message: 'Schon Ticket HAUS-2.' }
						: { state: '', message: '' }
				)
			)
		});
		const prepared = await prepareDroppedFiles(
			[
				mailFile('utf8-plain.eml'),
				calendar(),
				new File(['x'], 'bild.png', { type: 'image/png' }),
				mailFile('latin1-qp.eml')
			],
			d
		);
		expect(prepared.results).toEqual([
			{ name: 'bild.png', kind: 'error', message: NOT_EML_MESSAGE }
		]);
		const selection = prepared.selection;
		expect(selection).not.toBeNull();
		if (selection === null) return;
		expect(
			selection.entries.map(({ key, kind, title, keyword, blocked, detail }) => ({
				key,
				kind,
				title,
				keyword,
				blocked,
				detail
			}))
		).toEqual([
			expect.objectContaining({
				key: 'm:1',
				kind: 'mail',
				title: 'Grüße aus Köln',
				keyword: 'grüße',
				blocked: ''
			}),
			{
				key: 'c:2:0',
				kind: 'event',
				title: 'Todo: Steuer',
				keyword: 'todo',
				blocked: '',
				detail: ''
			},
			{
				key: 'c:2:1',
				kind: 'event',
				title: 'Chorprobe',
				keyword: '',
				blocked: '',
				detail: 'Saal 2 · Serie'
			},
			{
				key: 'c:2:2',
				kind: 'todo',
				title: 'Todo: Reifen',
				keyword: 'todo',
				blocked: 'Schon verworfen.',
				detail: ''
			},
			expect.objectContaining({ key: 'm:4', kind: 'mail', keyword: '' })
		]);
		expect(preselectedKeys(selection)).toEqual(['m:1', 'c:2:0']);
		expect(selection.mails.get('m:1')?.draft.sourceMeta).toMatchObject({ keyword: 'grüße' });
		expect(selection.mails.get('m:4')?.draft.sourceMeta?.keyword).toBeUndefined();
		expect(selection.withoutKeywords).toEqual([]);
		expect(selection.keywordsAvailable).toBe(true);
		expect(d.lookup).toHaveBeenCalledOnce();
	});

	it('searches the start of the text of a mail only on request', async () => {
		const settings = (matchBody: boolean): ImportKeywords => ({
			...EMPTY_IMPORT_KEYWORDS,
			eml: { keywords: ['köln'], matchBody }
		});
		const subjectOnly = await prepareDroppedFiles(
			[mailFile('utf8-plain.eml')],
			deps({ keywords: async () => settings(false) })
		);
		expect(subjectOnly.selection?.entries[0]?.keyword).toBe('köln');
		const other = await prepareDroppedFiles(
			[mailFile('latin1-qp.eml')],
			deps({ keywords: async () => settings(true) })
		);
		expect(other.selection?.entries[0]?.keyword).toBe('');
	});

	it('finds a keyword only in Cc or in the HTML part of a mail file with match_body', async () => {
		const source = [
			'From: Bert <bert@example.com>',
			'To: anna@example.com',
			'Cc: Projekt-X Team <team@example.com>',
			'Subject: Hallo',
			'MIME-Version: 1.0',
			'Content-Type: multipart/alternative; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain; charset=UTF-8',
			'',
			'Text',
			'--b',
			'Content-Type: text/html; charset=UTF-8',
			'',
			'<p>Bitte erledigen</p>',
			'--b--',
			''
		].join('\r\n');
		const file = () => new File([source], 'cc.eml', { type: 'message/rfc822' });
		for (const [keyword, matchBody, expected] of [
			['projekt-x', true, 'projekt-x'],
			['erledigen', true, 'erledigen'],
			['projekt-x', false, '']
		] as const) {
			const prepared = await prepareDroppedFiles(
				[file()],
				deps({
					keywords: async () => ({
						...EMPTY_IMPORT_KEYWORDS,
						eml: { keywords: [keyword], matchBody }
					})
				})
			);
			expect(prepared.selection?.entries[0]?.keyword, keyword).toBe(expected);
		}
	});

	it('chooses nothing without lists and names the kinds without keywords', async () => {
		const empty = await prepareDroppedFiles(
			[mailFile('utf8-plain.eml'), calendar()],
			deps({ keywords: async () => EMPTY_IMPORT_KEYWORDS })
		);
		expect(empty.selection?.withoutKeywords).toEqual(['eml', 'ics']);
		const before = await prepareDroppedFiles([calendar()], deps({ keywords: async () => null }));
		expect(before.selection?.keywordsAvailable).toBe(false);
		expect(before.selection && preselectedKeys(before.selection)).toEqual([]);
	});

	it('names calendar files that are too large, empty or refused, and stops at a lost session', async () => {
		const previewCalendar = vi
			.fn<PrepareDeps['previewCalendar']>()
			.mockResolvedValueOnce({ items: [], skipped: 2 })
			.mockRejectedValueOnce(new DataError('server', { status: 503 }))
			.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		const d = deps({ previewCalendar });
		const prepared = await prepareDroppedFiles(
			[
				calendar('gross.ics', ICS_MAX_BYTES + 1),
				calendar('leer.ics'),
				calendar('vorher.ics'),
				calendar('abgelaufen.ics'),
				calendar('danach.ics')
			],
			d
		);
		expect(prepared.results).toEqual([
			{ name: 'gross.ics', kind: 'error', message: CALENDAR_TOO_LARGE_MESSAGE },
			{
				name: 'leer.ics',
				kind: 'calendar',
				created: 0,
				duplicates: 0,
				skipped: 2,
				failed: 0,
				itemId: ''
			},
			{
				name: 'vorher.ics',
				kind: 'error',
				message: restartNeeded('Der Eingang ist')
			},
			{
				name: 'abgelaufen.ics',
				kind: 'error',
				message: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.'
			}
		]);
		expect(prepared.selection).toBeNull();
		expect(d.onSessionLost).toHaveBeenCalledOnce();
		expect(previewCalendar).toHaveBeenCalledTimes(3);
	});

	it('reads the first chat for its own view and refuses further ones', async () => {
		const prepared = await prepareDroppedFiles(
			[
				chatFile('WhatsApp Chat mit Familie Beispiel.txt'),
				chatFile('_chat.txt'),
				new File(['kein Export'], 'notiz.txt')
			],
			deps()
		);
		expect(prepared.chat).toMatchObject({ chat: 'Familie Beispiel' });
		expect(prepared.results).toEqual([
			{ name: '_chat.txt', kind: 'error', message: ONE_CHAT_AT_A_TIME },
			{ name: 'notiz.txt', kind: 'error', message: ONE_CHAT_AT_A_TIME }
		]);
		expect(prepared.keywords.whatsapp.keywords).toEqual(['milch']);
		expect(prepared.selection).toBeNull();
	});
});

describe('saveFileSelection', () => {
	it('saves only the chosen mails and the chosen components per calendar file', async () => {
		const prepared = await prepareDroppedFiles(
			[mailFile('utf8-plain.eml'), calendar(), mailFile('latin1-qp.eml')],
			deps()
		);
		const selection = prepared.selection;
		if (selection === null) throw new Error('no selection');
		const createItem = vi.fn().mockResolvedValue({
			kind: 'created',
			item: { id: 'item00000000001', title: 'Grüße aus Köln' }
		});
		const importCalendar = vi.fn().mockResolvedValue({
			kind: 'imported',
			created: 2,
			duplicates: 0,
			skipped: 1,
			failed: 0,
			itemId: ''
		});
		const results = await saveFileSelection(
			selection,
			new Set(['m:1', 'c:2:0', 'c:2:1', 'c:2:2']),
			{ createItem, importCalendar }
		);
		expect(createItem).toHaveBeenCalledOnce();
		expect(createItem.mock.calls[0]?.[0].sourceMeta).toMatchObject({ keyword: 'grüße' });
		expect(importCalendar).toHaveBeenCalledWith(expect.any(File), [0, 1]);
		expect(results).toEqual([
			{
				name: 'utf8-plain.eml',
				kind: 'created',
				itemId: 'item00000000001',
				title: 'Grüße aus Köln'
			},
			{
				name: 'kalender.ics',
				kind: 'calendar',
				created: 2,
				duplicates: 0,
				skipped: 1,
				failed: 0,
				itemId: ''
			}
		]);
		expect(importSummary(results)).toBe('3 neu, 1 übersprungen.');
	});

	it('keeps failures and duplicates per mail and stops at a lost session', async () => {
		const prepared = await prepareDroppedFiles(
			[mailFile('utf8-plain.eml'), mailFile('latin1-qp.eml'), mailFile('attachments.eml')],
			deps()
		);
		const selection = prepared.selection;
		if (selection === null) throw new Error('no selection');
		const createItem = vi
			.fn()
			.mockResolvedValueOnce({
				kind: 'duplicate',
				state: 'converted',
				itemId: 'item00000000002',
				ticketId: 'tick00000000002',
				ticketKey: 'HAUS-2',
				message: 'Schon Ticket HAUS-2.'
			})
			.mockResolvedValueOnce({ kind: 'error', message: 'Server nicht erreichbar.', fields: {} })
			.mockResolvedValueOnce({ kind: 'error', message: null, fields: {} });
		const results = await saveFileSelection(selection, new Set(['m:1', 'm:2', 'm:3']), {
			createItem,
			importCalendar: vi.fn()
		});
		expect(results).toEqual([
			{
				name: 'utf8-plain.eml',
				kind: 'duplicate',
				message: 'Schon Ticket HAUS-2.',
				itemId: 'item00000000002',
				ticketId: 'tick00000000002'
			},
			{ name: 'latin1-qp.eml', kind: 'error', message: 'Server nicht erreichbar.' },
			{
				name: 'attachments.eml',
				kind: 'error',
				message: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.'
			}
		]);
		expect(importSummary(results)).toBe('0 neu, 1 schon vorhanden, 2 mit Fehler.');
		expect(importCounts({ created: 2, duplicates: 0, skipped: 0, failed: 0 })).toBe('2 neu');
	});
});
