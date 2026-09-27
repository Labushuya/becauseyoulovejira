import { describe, expect, it } from 'vitest';
import {
	DELETED_VALUE,
	EMPTY_VALUE,
	RECURRENCE_ACTOR,
	describeHistoryEntry,
	historyLookups,
	type HistoryLookups
} from './history-format';
import type { HistoryEntry } from './ticket';

const ME = 'user0000000001';

const lookups: HistoryLookups = {
	projects: new Map([
		['proj00000000001', { id: 'proj00000000001', name: 'Finanzen', code: 'FIN', archived: false }],
		['proj00000000002', { id: 'proj00000000002', name: 'Haus', code: 'HAUS', archived: true }]
	]),
	tags: new Map([
		['tag000000000001', { id: 'tag000000000001', name: 'Amt' }],
		['tag000000000002', { id: 'tag000000000002', name: 'Bank' }]
	])
};

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
	return {
		id: 'hist00000000001',
		ticket: 'ticket000000001',
		field: 'title',
		oldValue: '',
		newValue: '',
		user: ME,
		created: '2026-09-24 10:05:00.000Z',
		...overrides
	};
}

function text(overrides: Partial<HistoryEntry>): string {
	return describeHistoryEntry(entry(overrides), lookups, ME).text;
}

describe('describeHistoryEntry', () => {
	it('names linked and released sources with channel and title (ADR-0031)', () => {
		const value = JSON.stringify({
			item: 'item00000000001',
			channel: 'mail',
			title: 'Rechnung März'
		});
		expect(text({ field: 'source_link', newValue: value })).toBe(
			'Quelle verknüpft: Postfach „Rechnung März“'
		);
		expect(text({ field: 'source_link', oldValue: value })).toBe(
			'Quelle gelöst: Postfach „Rechnung März“'
		);
		const unknown = JSON.stringify({ item: 'x', channel: 'fax', title: '' });
		expect(text({ field: 'source_link', newValue: unknown })).toBe('Quelle verknüpft');
		expect(text({ field: 'source_link', oldValue: 'kein JSON' })).toBe('Quelle gelöst');
		expect(text({ field: 'source_link', newValue: 'null' })).toBe('Quelle verknüpft');
	});

	it('shows time in Berlin, actor and id', () => {
		expect(describeHistoryEntry(entry({}), lookups, ME)).toMatchObject({
			id: 'hist00000000001',
			time: '24.09.2026 12:05',
			actor: 'Du',
			details: null
		});
	});

	it.each([
		['', 'System'],
		['user0000000002', 'Anderes Konto'],
		[ME, 'Du']
	])('labels the actor %j as %j', (user, actor) => {
		expect(describeHistoryEntry(entry({ user }), lookups, ME).actor).toBe(actor);
	});

	it('names "Wiederholung" as the author of a ticket a rule created (E5 plan, T-9)', () => {
		const generated = entry({
			field: 'created',
			oldValue: 'rule00000000001',
			newValue: 'HAUS-4',
			user: ''
		});
		expect(describeHistoryEntry(generated, lookups, ME)).toMatchObject({
			actor: RECURRENCE_ACTOR,
			text: 'hat das Ticket angelegt (HAUS-4)'
		});
		expect(RECURRENCE_ACTOR).toBe('Wiederholung');
		// Created by a user or by the system without a rule: as before.
		expect(describeHistoryEntry({ ...generated, user: ME }, lookups, ME).actor).toBe('Du');
		expect(describeHistoryEntry({ ...generated, oldValue: '' }, lookups, ME).actor).toBe('System');
	});

	it.each<[string, Partial<HistoryEntry>, string]>([
		['creation', { field: 'created', newValue: 'TASK-12' }, 'hat das Ticket angelegt (TASK-12)'],
		['creation without key', { field: 'created' }, 'hat das Ticket angelegt'],
		[
			'status',
			{ field: 'status', oldValue: 'open', newValue: 'in_progress' },
			'Status: Offen → In Arbeit'
		],
		[
			'status done',
			{ field: 'status', oldValue: 'waiting', newValue: 'done' },
			'Status: Wartet → Erledigt'
		],
		[
			'priority',
			{ field: 'priority', oldValue: 'low', newValue: 'urgent' },
			'Priorität: Niedrig → Dringend'
		],
		[
			'due set',
			{ field: 'due', newValue: '2026-10-01 00:00:00.000Z' },
			'Fälligkeit gesetzt: 01.10.2026'
		],
		[
			'due changed',
			{ field: 'due', oldValue: '2026-10-01 00:00:00.000Z', newValue: '2026-10-15 00:00:00.000Z' },
			'Fälligkeit: 01.10.2026 → 15.10.2026'
		],
		[
			'due removed',
			{ field: 'due', oldValue: '2026-10-01 00:00:00.000Z' },
			'Fälligkeit entfernt (war 01.10.2026)'
		],
		['title', { field: 'title', oldValue: 'Alt', newValue: 'Neu' }, 'Titel: Alt → Neu'],
		[
			'description',
			{ field: 'description', oldValue: 'a', newValue: 'b' },
			'Beschreibung geändert'
		],
		[
			'key',
			{ field: 'key', oldValue: 'TASK-3', newValue: 'FIN-1' },
			'Key geändert: TASK-3 → FIN-1'
		],
		[
			'project set',
			{ field: 'project', newValue: 'proj00000000001' },
			`Projekt: ${EMPTY_VALUE} → Finanzen (FIN)`
		],
		[
			'project changed to an archived one',
			{ field: 'project', oldValue: 'proj00000000001', newValue: 'proj00000000002' },
			'Projekt: Finanzen (FIN) → Haus (HAUS)'
		],
		[
			'project unknown',
			{ field: 'project', oldValue: 'proj00000000009', newValue: '' },
			`Projekt: ${DELETED_VALUE} → ${EMPTY_VALUE}`
		],
		['tag added', { field: 'tags', newValue: '["tag000000000001"]' }, 'Tag hinzugefügt: Amt'],
		[
			'tags added and removed',
			{
				field: 'tags',
				oldValue: '["tag000000000001"]',
				newValue: '["tag000000000002","tag000000000009"]'
			},
			`Tags hinzugefügt: Bank, ${DELETED_VALUE}; Tag entfernt: Amt`
		],
		[
			'all tags removed',
			{ field: 'tags', oldValue: '["tag000000000001","tag000000000002"]' },
			'Tags entfernt: Amt, Bank'
		],
		[
			'household set',
			{ field: 'household', newValue: 'house0000000001' },
			'Bereich: Privat → Haushalt'
		],
		[
			'household cleared',
			{ field: 'household', oldValue: 'house0000000001' },
			'Bereich: Haushalt → Privat'
		],
		[
			'recurrence set',
			{ field: 'recurrence', newValue: 'rule00000000001' },
			'Wiederholung eingerichtet'
		],
		[
			'recurrence removed',
			{ field: 'recurrence', oldValue: 'rule00000000001' },
			'Wiederholung entfernt'
		],
		[
			'recurrence changed',
			{ field: 'recurrence', oldValue: 'rule00000000001', newValue: 'rule00000000002' },
			'Wiederholung geändert'
		],
		['unknown field', { field: 'mystery' }, 'mystery geändert'],
		['empty title', { field: 'title', oldValue: 'Alt' }, `Titel: Alt → ${EMPTY_VALUE}`]
	])('describes %s', (_name, overrides, expected) => {
		expect(text(overrides)).toBe(expected);
	});

	it('returns old and new description as plain text details', () => {
		const line = describeHistoryEntry(
			entry({ field: 'description', oldValue: '**alt**', newValue: '<b>neu</b>' }),
			lookups,
			ME
		);

		expect(line.details).toEqual({ before: '**alt**', after: '<b>neu</b>' });
	});

	it('shows an unexpected due value as stored instead of failing', () => {
		expect(text({ field: 'due', oldValue: 'kaputt', newValue: '2026-10-01 00:00:00.000Z' })).toBe(
			'Fälligkeit: kaputt → 01.10.2026'
		);
	});
});

describe('historyLookups', () => {
	it('keys projects and tags by ID', () => {
		const project = { id: 'p1', name: 'Finanzen', code: 'FIN', archived: false };
		const tag = { id: 't1', name: 'Amt' };

		const built = historyLookups([project], [tag]);

		expect(built.projects.get('p1')).toBe(project);
		expect(built.tags.get('t1')).toBe(tag);
	});
});
