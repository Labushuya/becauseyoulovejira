import { describe, expect, it } from 'vitest';
import {
	DELETED_VALUE,
	EMPTY_VALUE,
	RECURRENCE_ACTOR,
	describeHistoryEntry,
	historyLookups,
	withComments,
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

	it('names the other ticket of a moved source (ADR-0031 addendum)', () => {
		const base = { item: 'item00000000001', channel: 'telegram', title: 'Termin' };
		expect(
			text({
				field: 'source_link',
				oldValue: JSON.stringify({ ...base, moved_to: { ticket: 't2', key: 'HAUS-13' } })
			})
		).toBe('Quelle verschoben nach HAUS-13: Telegram „Termin“');
		expect(
			text({
				field: 'source_link',
				newValue: JSON.stringify({ ...base, moved_from: { ticket: 't1', key: 'HAUS-12' } })
			})
		).toBe('Quelle verschoben von HAUS-12: Telegram „Termin“');
		expect(
			text({ field: 'source_link', newValue: JSON.stringify({ ...base, moved_from: null }) })
		).toBe('Quelle verschoben: Telegram „Termin“');
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

	it('names the missed dates a catch-up ticket stands for (ADR-0022 addendum 4)', () => {
		const note = entry({
			field: 'recurrence_skipped',
			oldValue: 'rule00000000001',
			newValue: JSON.stringify({ count: 2, dates: ['2026-10-12', '2026-10-19'], more: false }),
			user: ''
		});
		expect(describeHistoryEntry(note, lookups, ME)).toMatchObject({
			actor: RECURRENCE_ACTOR,
			text: '2 Termine übersprungen (12.10.2026, 19.10.2026), zusammengefasst in diesem Ticket'
		});
		expect(describeHistoryEntry({ ...note, newValue: 'kaputt' }, lookups, ME).text).toBe(
			'Verpasste Termine zusammengefasst'
		);
	});

	it('names the sub-tasks a ticket of a series got from the template (ADR-0022 addendum 10)', () => {
		const note = entry({
			field: 'recurrence_subtasks',
			oldValue: 'rule00000000001',
			newValue: JSON.stringify({ count: 3, tickets: ['a', 'b', 'c'] }),
			user: ''
		});
		expect(describeHistoryEntry(note, lookups, ME)).toMatchObject({
			actor: RECURRENCE_ACTOR,
			text: '3 Unteraufgaben aus der Vorlage angelegt'
		});
		const one = JSON.stringify({ count: 1, tickets: ['a'] });
		expect(describeHistoryEntry({ ...note, newValue: one }, lookups, ME).text).toBe(
			'1 Unteraufgabe aus der Vorlage angelegt'
		);
		expect(describeHistoryEntry({ ...note, newValue: 'kaputt' }, lookups, ME).text).toBe(
			'Unteraufgaben aus der Vorlage angelegt'
		);
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

	it.each([
		[
			'a ticked task',
			'- [ ] Milch\n- [ ] Brot',
			'- [ ] Milch\n- [x] Brot',
			'Aufgabe abgehakt: Brot'
		],
		['an unticked task', '> * [X] Zitat', '> * [ ] Zitat', 'Aufgabe wieder offen: Zitat'],
		[
			'escapes of a template',
			'- [ ] Milch 1\\.5 %',
			'- [x] Milch 1\\.5 %',
			'Aufgabe abgehakt: Milch 1.5 %'
		],
		['an empty task', '- [x]', '- [ ]', 'Aufgabe wieder offen'],
		['CRLF', 'a\r\n- [ ] b', 'a\r\n- [x] b', 'Aufgabe abgehakt: b'],
		['two changed lines', '- [ ] a\n- [ ] b', '- [x] a\n- [x] b', 'Beschreibung geändert'],
		['a changed text', '- [ ] a', '- [x] b', 'Beschreibung geändert'],
		['another line count', '- [ ] a', '- [x] a\nb', 'Beschreibung geändert'],
		['brackets inside the text', 'Text [ ] mitten', 'Text [x] mitten', 'Beschreibung geändert']
	])('names %s of the description', (_name, oldValue, newValue, expected) => {
		expect(text({ field: 'description', oldValue, newValue })).toBe(expected);
	});

	it('shortens a long task', () => {
		const task = 'x'.repeat(100);
		const line = text({
			field: 'description',
			oldValue: `- [ ] ${task}`,
			newValue: `- [x] ${task}`
		});

		expect(line).toBe(`Aufgabe abgehakt: ${'x'.repeat(79)}…`);
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

describe('pinned comment in the history (ADR-0044)', () => {
	const A = 'comment00000001';
	const B = 'comment00000002';
	const withLoaded = withComments(lookups, [
		{ id: A, author: ME, created: '2026-09-24 09:00:00.000Z' },
		{ id: B, author: 'user0000000009', created: '2026-09-24 10:30:00.000Z' }
	]);
	const pinText = (oldValue: string, newValue: string, known = withLoaded) =>
		describeHistoryEntry(entry({ field: 'pinned_comment', oldValue, newValue }), known, ME).text;

	it('names pinning, replacing and releasing with the comment while it is loaded', () => {
		expect(pinText('', A)).toBe('Kommentar angepinnt: Kommentar von Du vom 24.09.2026 11:00');
		expect(pinText(A, B)).toBe(
			'Angepinnten Kommentar ersetzt: Kommentar von Anderes Konto vom 24.09.2026 12:30'
		);
		expect(pinText(B, '')).toBe(
			'Anpinnen gelöst: Kommentar von Anderes Konto vom 24.09.2026 12:30'
		);
	});

	it('names only what happened when the comment is gone', () => {
		expect(pinText('', A, lookups)).toBe('Kommentar angepinnt');
		expect(pinText(A, B, lookups)).toBe('Angepinnten Kommentar ersetzt');
		expect(pinText(A, '', lookups)).toBe('Anpinnen gelöst');
	});
});

describe('color in the history (ADR-0052)', () => {
	it('names setting, changing and clearing the own color; empty is "wie Projekt"', () => {
		expect(text({ field: 'color', oldValue: '', newValue: 'blau' })).toBe(
			'Farbe: wie Projekt → Blau'
		);
		expect(text({ field: 'color', oldValue: 'blau', newValue: 'himmel' })).toBe(
			'Farbe: Blau → Himmelblau'
		);
		expect(text({ field: 'color', oldValue: 'tuerkis', newValue: '' })).toBe(
			'Farbe: Türkis → wie Projekt'
		);
		expect(text({ field: 'color', oldValue: 'alt', newValue: 'grau' })).toBe('Farbe: alt → Grau');
	});
});

describe('duplicate in the history (ADR-0045)', () => {
	const duplicateText = (newValue: string) => text({ field: 'duplicate', newValue });

	it('names the original in the duplicate and the duplicate in the original, with the user', () => {
		const from = JSON.stringify({ direction: 'from', ticket: 'ticket000000001', key: 'HAUS-12' });
		const to = JSON.stringify({ direction: 'to', ticket: 'ticket000000002', key: 'HAUS-13' });
		expect(duplicateText(from)).toBe('Dupliziert aus HAUS-12');
		expect(duplicateText(to)).toBe('Dupliziert nach HAUS-13');
		expect(
			describeHistoryEntry(entry({ field: 'duplicate', newValue: to }), lookups, ME).actor
		).toBe('Du');
	});

	it('says only "Dupliziert" for a value it cannot read', () => {
		expect(duplicateText('')).toBe('Dupliziert');
		expect(duplicateText('{"direction":"sideways","key":"X-1"}')).toBe('Dupliziert');
		expect(duplicateText(JSON.stringify({ direction: 'from', key: '' }))).toBe('Dupliziert aus');
	});
});

describe('moving between the areas in the history (ADR-0060 §3)', () => {
	it('names the direction and the key before, with the user', () => {
		const line = describeHistoryEntry(
			entry({
				field: 'area_move',
				oldValue: 'PRIV-12',
				newValue: JSON.stringify({ to: 'household', key: 'HAUS-3' })
			}),
			lookups,
			ME
		);
		expect(line.text).toBe('In den Haushalt verschoben (vorher PRIV-12)');
		expect(line.actor).toBe('Du');
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
