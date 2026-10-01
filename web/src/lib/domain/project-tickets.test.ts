// Unit tests for the open tickets of a project in the project view (ADR-0034, addendum "Offene
// Tickets in Projekten"; plan projekte-tickets): order by due date and priority, done tickets
// left out, the limit with "Alle N in Aufgaben öffnen", many tickets at once, and the rows kept
// open in localStorage with a blocked storage.

import { describe, expect, it } from 'vitest';
import {
	PROJECT_TICKETS_FAILED,
	PROJECT_TICKETS_LIMIT,
	PROJECT_TICKETS_REMEMBERED_MAX,
	PROJECT_TICKETS_STORAGE_KEY,
	allTicketsText,
	compareProjectTickets,
	noProjectTicketsText,
	openTicketsByProject,
	openTicketsOf,
	projectTicketsLabel,
	readOpenProjectTickets,
	sliceProjectTickets,
	writeOpenProjectTickets
} from './project-tickets';
import type { Priority, Status } from './status';
import type { TicketSummary } from './ticket';

const T0 = '2026-10-01 08:00:00.000Z';
const HOUSE = 'house0000000001';
const GARDEN = 'garden000000001';

let sequence = 0;

function ticket(
	key: string,
	{
		project = HOUSE as string | null,
		due = null as string | null,
		priority = 'medium' as Priority,
		status = 'open' as Status
	} = {}
): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key,
		title: `Ticket ${key}`,
		status,
		priority,
		due,
		projectId: project,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0
	};
}

const keys = (tickets: readonly TicketSummary[]) => tickets.map((entry) => entry.key);

function memory(): { storage: Storage; values: Map<string, string> } {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		removeItem: (key: string) => void values.delete(key)
	} as Storage;
	return { storage, values };
}

describe('order of the open tickets of a project', () => {
	it('sorts by due date, without one last, then by priority, then by key', () => {
		const list = [
			ticket('HAUS-1'),
			ticket('HAUS-2', { due: '2026-10-05', priority: 'low' }),
			ticket('HAUS-3', { due: '2026-10-03' }),
			ticket('HAUS-4', { due: '2026-10-05', priority: 'urgent' }),
			ticket('HAUS-10', { priority: 'high' }),
			ticket('HAUS-9', { priority: 'high' }),
			ticket('HAUS-5', { due: '2026-09-28', priority: 'low' })
		];
		expect(keys([...list].sort(compareProjectTickets))).toEqual([
			'HAUS-5',
			'HAUS-3',
			'HAUS-4',
			'HAUS-2',
			'HAUS-9',
			'HAUS-10',
			'HAUS-1'
		]);
	});

	it('takes only open tickets of the project, done ones never', () => {
		const list = [
			ticket('HAUS-1', { due: '2026-10-09' }),
			ticket('HAUS-2', { status: 'done' }),
			ticket('GART-1', { project: GARDEN }),
			ticket('TASK-1', { project: null }),
			ticket('HAUS-3', { status: 'backlog', due: '2026-10-02' }),
			ticket('HAUS-4', { status: 'waiting' })
		];
		expect(keys(openTicketsOf(list, HOUSE))).toEqual(['HAUS-3', 'HAUS-1', 'HAUS-4']);
		expect(keys(openTicketsOf(list, GARDEN))).toEqual(['GART-1']);
		expect(openTicketsOf(list, 'unknown00000001')).toEqual([]);
	});

	it('groups every project in one pass, each in the same order', () => {
		const list = [
			ticket('GART-2', { project: GARDEN }),
			ticket('HAUS-1'),
			ticket('GART-1', { project: GARDEN, due: '2026-10-02' }),
			ticket('HAUS-2', { status: 'done' }),
			ticket('TASK-1', { project: null })
		];
		const grouped = openTicketsByProject(list);
		expect([...grouped.keys()].sort()).toEqual([GARDEN, HOUSE]);
		expect(keys(grouped.get(GARDEN) ?? [])).toEqual(['GART-1', 'GART-2']);
		expect(keys(grouped.get(HOUSE) ?? [])).toEqual(['HAUS-1']);
		expect(keys(grouped.get(GARDEN) ?? [])).toEqual(keys(openTicketsOf(list, GARDEN)));
	});
});

describe('limit of a list', () => {
	it('shows at most ten and says how many there are', () => {
		const list = Array.from({ length: 12 }, (_, index) => ticket(`HAUS-${index + 1}`));
		const slice = sliceProjectTickets(list);
		expect(PROJECT_TICKETS_LIMIT).toBe(10);
		expect(slice.shown).toHaveLength(10);
		expect(slice.shown[0]?.key).toBe('HAUS-1');
		expect(slice).toMatchObject({ total: 12, more: true });
		expect(allTicketsText(slice.total)).toBe('Alle 12 in Aufgaben öffnen');

		expect(sliceProjectTickets(list.slice(0, 10))).toMatchObject({ total: 10, more: false });
		expect(sliceProjectTickets([])).toEqual({ shown: [], total: 0, more: false });
		expect(sliceProjectTickets(list, 3).shown).toHaveLength(3);
	});

	it('handles many tickets in one pass and still cuts every list to the limit', () => {
		const projects = Array.from(
			{ length: 50 },
			(_, index) => `p${String(index).padStart(14, '0')}`
		);
		const list = Array.from({ length: 5000 }, (_, index) =>
			ticket(`P${index % 50}-${index}`, {
				project: projects[index % 50] ?? null,
				due: index % 3 === 0 ? null : `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
				status: index % 7 === 0 ? 'done' : 'open'
			})
		);
		const grouped = openTicketsByProject(list);
		expect(grouped.size).toBe(50);
		let total = 0;
		for (const [projectId, tickets] of grouped) {
			total += tickets.length;
			expect(
				tickets.every((entry) => entry.projectId === projectId && entry.status !== 'done')
			).toBe(true);
			const ordered = [...tickets].sort(compareProjectTickets);
			expect(keys(tickets)).toEqual(keys(ordered));
			expect(sliceProjectTickets(tickets).shown).toHaveLength(PROJECT_TICKETS_LIMIT);
		}
		expect(total).toBe(list.filter((entry) => entry.status !== 'done').length);
	});
});

describe('texts', () => {
	it('names the list, its emptiness and a failure', () => {
		expect(projectTicketsLabel('Haus', false)).toBe('Offene Tickets von „Haus“');
		expect(projectTicketsLabel('Haus', true)).toBe('Offene Tickets direkt in „Haus“');
		expect(noProjectTicketsText('Haus', false)).toBe('Keine offenen Tickets');
		expect(noProjectTicketsText('Haus', true)).toBe('Keine offenen Tickets direkt in „Haus“');
		expect(PROJECT_TICKETS_FAILED).toBe('Die offenen Tickets ließen sich nicht laden.');
	});
});

describe('rows kept open on this device', () => {
	it('reads and writes the IDs strictly, the newest last', () => {
		const { storage, values } = memory();
		expect(PROJECT_TICKETS_STORAGE_KEY).toBe('byl-projects-tickets');
		expect(readOpenProjectTickets(storage)).toEqual([]);
		writeOpenProjectTickets(storage, [HOUSE, GARDEN]);
		expect(values.get(PROJECT_TICKETS_STORAGE_KEY)).toBe(`["${HOUSE}","${GARDEN}"]`);
		expect(readOpenProjectTickets(storage)).toEqual([HOUSE, GARDEN]);
		writeOpenProjectTickets(storage, []);
		expect(values.has(PROJECT_TICKETS_STORAGE_KEY)).toBe(false);

		values.set(PROJECT_TICKETS_STORAGE_KEY, '{"x":1}');
		expect(readOpenProjectTickets(storage)).toEqual([]);
		values.set(PROJECT_TICKETS_STORAGE_KEY, `["kurz", 5, "${HOUSE}", "${HOUSE}"]`);
		expect(readOpenProjectTickets(storage)).toEqual([HOUSE]);
		values.set(PROJECT_TICKETS_STORAGE_KEY, 'kaputt');
		expect(readOpenProjectTickets(storage)).toEqual([]);
		expect(readOpenProjectTickets(null)).toEqual([]);
	});

	it(`keeps at most ${PROJECT_TICKETS_REMEMBERED_MAX} rows, the ones opened last`, () => {
		const { storage } = memory();
		const ids = Array.from(
			{ length: PROJECT_TICKETS_REMEMBERED_MAX + 3 },
			(_, index) => `p${String(index).padStart(14, '0')}`
		);
		writeOpenProjectTickets(storage, ids);
		const kept = readOpenProjectTickets(storage);
		expect(kept).toHaveLength(PROJECT_TICKETS_REMEMBERED_MAX);
		expect(kept[0]).toBe(ids[3]);
		expect(kept.at(-1)).toBe(ids.at(-1));
	});

	it('survives a blocked or full storage', () => {
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readOpenProjectTickets(blocked)).toEqual([]);
		expect(() => writeOpenProjectTickets(blocked, [HOUSE])).not.toThrow();
		expect(() => writeOpenProjectTickets(blocked, [])).not.toThrow();
	});
});
