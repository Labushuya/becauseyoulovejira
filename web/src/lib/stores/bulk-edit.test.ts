// Bulk actions of the ticket table (plan BI-2, ADR-0036 §3 and §4): one request per ticket with
// limited concurrency, progress, results with reasons, "Erledigen" with sub-tasks and series,
// "Löschen" with the sources, "Rückgängig" and the end of a session.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { BULK_CONCURRENCY } from '$lib/domain/bulk';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { BulkEditStore, progressText, type BulkEditData, type BulkList } from './bulk-edit.svelte';
import type { FlagInput, FlagSink } from './flags.svelte';

function ticket(id: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id,
		key: `HAUS-${id}`,
		title: `Ticket ${id}`,
		status: 'open',
		priority: 'medium',
		due: '2026-10-01',
		projectId: 'project00000001',
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function refusal(field: string, code: string, message: string, params?: Record<string, unknown>) {
	return new DataError('validation', {
		status: 400,
		fields: { [field]: { code, message, ...(params ? { params } : {}) } }
	});
}

let clock = 0;
function nextUpdated(): string {
	clock += 1;
	return `2026-09-28 10:00:${String(clock % 60).padStart(2, '0')}.${String(clock).padStart(3, '0')}Z`;
}

/** A list over a map of tickets, like the TicketListStore offers it. */
function listOf(tickets: TicketSummary[]) {
	const known = new Map(tickets.map((entry) => [entry.id, entry]));
	const list: BulkList & { known: Map<string, TicketSummary> } = {
		known,
		find: (id) => known.get(id) ?? null,
		upsert: (entry) => void known.set(entry.id, entry),
		remove: (id) => void known.delete(id),
		openBlockingOf: (parentId) =>
			[...known.values()].filter(
				(entry) =>
					entry.parentId === parentId && entry.status !== 'done' && entry.blocksParent !== false
			)
	};
	return list;
}

function setup(tickets: TicketSummary[], overrides: Partial<BulkEditData> = {}) {
	const list = listOf(tickets);
	const update = vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
		const current = list.known.get(id);
		if (current === undefined) throw new DataError('not_found', { status: 404 });
		const { project, tags, ...fields } = patch;
		return {
			...current,
			...fields,
			...(project !== undefined ? { projectId: project, key: `NEU-${id}` } : {}),
			...(tags !== undefined ? { tagIds: tags } : {}),
			updated: nextUpdated()
		} as TicketSummary;
	});
	const data: BulkEditData = {
		update,
		delete: vi.fn(async () => null),
		restore: vi.fn(async () => undefined),
		sourceDates: vi.fn(async () => new Map()),
		sourceCount: vi.fn(async () => 0),
		...overrides
	};
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const shown: FlagInput[] = [];
	const flags: FlagSink = {
		show: (input) => {
			shown.push(input);
			return `flag-${shown.length}`;
		},
		dismiss: vi.fn()
	};
	const store = new BulkEditStore(data, session, list, flags);
	return { store, list, data, update: data.update as typeof update, session, shown, flags };
}

describe('BulkEditStore: field changes', () => {
	it('changes only the tickets that differ, one request each with the field alone', async () => {
		const { store, update, shown } = setup([
			ticket('1'),
			ticket('2', { priority: 'high' }),
			ticket('3')
		]);

		const result = await store.run({ kind: 'priority', value: 'high' }, ['1', '2', '3']);

		expect(update).toHaveBeenCalledTimes(2);
		expect(update).toHaveBeenCalledWith('1', { priority: 'high' });
		expect(update).toHaveBeenCalledWith('3', { priority: 'high' });
		expect(result?.counts).toEqual({ changed: 2, skipped: 0, unchanged: 1, failed: 0 });
		expect(store.result).toBeNull();
		expect(shown.at(-1)).toMatchObject({
			tone: 'success',
			title: '2 Tickets geändert, 1 unverändert.',
			action: { label: 'Rückgängig' }
		});
		expect(store.canUndo).toBe(true);
	});

	it('runs at most BULK_CONCURRENCY requests at once and reports the progress', async () => {
		const tickets = Array.from({ length: 10 }, (_, index) => ticket(String(index + 1)));
		let running = 0;
		let most = 0;
		const releases: (() => void)[] = [];
		const { store, list } = setup(tickets, {
			update: async (id, patch) => {
				running += 1;
				most = Math.max(most, running);
				await new Promise<void>((resolve) => releases.push(resolve));
				running -= 1;
				return {
					...(list.find(id) as TicketSummary),
					...patch,
					updated: nextUpdated()
				} as TicketSummary;
			}
		});

		const done = store.run(
			{ kind: 'status', value: 'waiting' },
			tickets.map((entry) => entry.id)
		);
		await vi.waitFor(() => expect(releases).toHaveLength(BULK_CONCURRENCY));
		expect(store.busy).toBe(true);
		expect(store.progress).toEqual({ label: 'Status ändern', total: 10, done: 0 });
		while (releases.length > 0 || store.busy) {
			releases.shift()?.();
			await Promise.resolve();
			await Promise.resolve();
		}
		await done;

		expect(most).toBe(BULK_CONCURRENCY);
		expect(store.busy).toBe(false);
		expect(progressText({ label: 'Status ändern', total: 10, done: 3 })).toBe(
			'Status ändern: 3 von 10 Tickets'
		);
	});

	it('lists refused and skipped tickets with their reason and keeps the others', async () => {
		const { store, list } = setup([ticket('1'), ticket('2', { due: null }), ticket('3')], {
			update: async (id, patch) => {
				if (id === '3') throw refusal('due', 'validation_calendar_date', 'Ungültiges Datum.');
				return {
					...(list.find(id) as TicketSummary),
					...patch,
					updated: nextUpdated()
				} as TicketSummary;
			}
		});

		const result = await store.run({ kind: 'due', mode: 'shift', amount: 1, unit: 'weeks' }, [
			'1',
			'2',
			'3'
		]);

		expect(list.find('1')?.due).toBe('2026-10-08');
		expect(result?.counts).toEqual({ changed: 1, skipped: 1, unchanged: 0, failed: 1 });
		expect(store.result?.failures).toEqual([
			{ id: '3', key: 'HAUS-3', reason: 'Ungültiges Datum.' }
		]);
		expect(store.result?.skipped).toEqual([
			{ id: '2', key: 'HAUS-2', reason: 'Hat keine Fälligkeit zum Verschieben.' }
		]);
		store.dismissResult();
		expect(store.result).toBeNull();
	});

	it('shows an error flag when every request failed', async () => {
		const { store, shown } = setup([ticket('1')], {
			update: async () => {
				throw new DataError('network');
			}
		});
		await store.run({ kind: 'priority', value: 'low' }, ['1']);
		expect(shown.at(-1)).toMatchObject({
			tone: 'error',
			title: '0 Tickets geändert, 1 fehlgeschlagen.'
		});
		expect(store.canUndo).toBe(false);
	});

	it('takes the date of the source event and skips tickets without one', async () => {
		const sourceDates = vi.fn(async () => new Map([['1', '2026-11-05']]));
		const { store, update } = setup([ticket('1'), ticket('2')], { sourceDates });

		const result = await store.run({ kind: 'due', mode: 'source' }, ['1', '2']);

		expect(sourceDates).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledExactlyOnceWith('1', { due: '2026-11-05' });
		expect(result?.skipped).toEqual([
			{
				id: '2',
				key: 'HAUS-2',
				reason: 'Die Hauptquelle ist kein Termin und kein Notion-Eintrag mit Datum.'
			}
		]);
	});

	it('changes the project through the Record API, so each ticket gets its new key', async () => {
		const { store, update, list } = setup([ticket('1'), ticket('2')]);
		await store.run({ kind: 'project', projectId: 'project00000002' }, ['1', '2']);
		expect(update).toHaveBeenCalledWith('1', { project: 'project00000002' });
		expect(list.find('1')?.key).toBe('NEU-1');
	});

	it('adds and removes tags on top of the tags each ticket has', async () => {
		const { store, update } = setup([
			ticket('1', { tagIds: ['a'] }),
			ticket('2', { tagIds: ['b'] })
		]);
		await store.run({ kind: 'tags', mode: 'add', tagIds: ['b'] }, ['1', '2']);
		expect(update).toHaveBeenCalledExactlyOnceWith('1', { tags: ['a', 'b'] });
	});
});

describe('BulkEditStore: "Rückgängig"', () => {
	it('restores the fields of every changed ticket, guarded by its last known version', async () => {
		const { store, update, list, shown } = setup([
			ticket('1', { priority: 'low' }),
			ticket('2', { priority: 'urgent' })
		]);
		await store.run({ kind: 'priority', value: 'medium' }, ['1', '2']);
		const updatedAfter = list.find('1')?.updated;
		update.mockClear();

		shown.at(-1)?.action?.run();
		await vi.waitFor(() => expect(store.busy).toBe(false));
		await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));

		expect(update).toHaveBeenCalledWith(
			'1',
			{ priority: 'low' },
			{ expectedUpdated: updatedAfter }
		);
		expect(list.find('2')?.priority).toBe('urgent');
		expect(shown.at(-1)).toMatchObject({ tone: 'success', title: '2 Tickets zurückgesetzt.' });
		expect(store.canUndo).toBe(false);
	});

	it('names a ticket changed meanwhile instead of overwriting it', async () => {
		const { store, list, data } = setup([ticket('1', { priority: 'low' })]);
		await store.run({ kind: 'priority', value: 'high' }, ['1']);
		data.update = vi.fn(async () => {
			throw refusal(
				'description',
				'validation_description_stale',
				'Die Beschreibung wurde inzwischen geändert.'
			);
		});

		await store.undo();

		expect(list.find('1')?.priority).toBe('high');
		expect(store.result?.failures).toEqual([
			{ id: '1', key: 'HAUS-1', reason: 'Wurde inzwischen geändert, nicht zurückgesetzt.' }
		]);
	});

	it('offers nothing to undo after "Löschen" before the migration of the trash; a new action replaces the old offer', async () => {
		const { store, flags, shown } = setup([ticket('1'), ticket('2')]);
		await store.run({ kind: 'priority', value: 'low' }, ['1']);
		expect(store.canUndo).toBe(true);
		await store.run({ kind: 'delete', sources: 'inbox' }, ['2']);
		expect(flags.dismiss).toHaveBeenCalledWith('flag-1');
		expect(store.canUndo).toBe(false);
		expect(shown.at(-1)).toMatchObject({ tone: 'success', title: '1 Ticket gelöscht.' });
		expect(shown.at(-1)?.action).toBeUndefined();
	});

	it('restores tickets moved to the trash, guarded by expected_updated (ADR-0037 §7)', async () => {
		const moved = (id: string) => ({
			id,
			updated: `2026-09-28 10:00:0${id}.000Z`,
			tickets: [{ id, key: `TASK-${id}`, updated: `2026-09-28 10:00:0${id}.000Z` }]
		});
		const restore = vi.fn<BulkEditData['restore']>(async (id) => {
			if (id === '2') {
				throw new DataError('validation', {
					status: 400,
					fields: {
						id: {
							code: 'validation_trash_stale',
							message: 'Das Ticket wurde inzwischen wiederhergestellt oder geändert.'
						}
					}
				});
			}
		});
		const { store, shown } = setup([ticket('1'), ticket('2')], {
			delete: vi.fn(async (id: string) => moved(id)),
			restore
		});
		await store.run({ kind: 'delete', sources: 'inbox' }, ['1', '2']);
		expect(shown.at(-1)).toMatchObject({
			tone: 'success',
			title: '2 Tickets in den Papierkorb verschoben.'
		});
		expect(shown.at(-1)?.action?.label).toBe('Rückgängig');

		const result = await store.undo();
		expect(restore).toHaveBeenCalledWith('1', '2026-09-28 10:00:01.000Z');
		expect(restore).toHaveBeenCalledWith('2', '2026-09-28 10:00:02.000Z');
		expect(result?.title).toBe('1 Ticket wiederhergestellt, 1 fehlgeschlagen.');
		expect(result?.failures).toEqual([
			{
				id: '2',
				key: 'HAUS-2',
				reason: 'Das Ticket wurde inzwischen wiederhergestellt oder geändert.'
			}
		]);
	});

	it('moves chosen sub-tasks along with their chosen parent: the parent goes first', async () => {
		const order: string[] = [];
		const { store } = setup([ticket('p'), ticket('c', { parentId: 'p' })], {
			delete: vi.fn(async (id: string) => {
				order.push(id);
				if (id === 'c') throw new DataError('not_found', { status: 404 });
				return { id, updated: 'u', tickets: [] };
			})
		});
		const result = await store.run({ kind: 'delete', sources: 'inbox' }, ['c', 'p']);
		expect(order).toEqual(['p', 'c']);
		expect(result?.counts.changed).toBe(2);
		expect(result?.failures).toEqual([]);
	});
});

describe('BulkEditStore: "Erledigen" (ADR-0033, ADR-0022)', () => {
	it('completes chosen sub-tasks first, then the parent without asking for them', async () => {
		const order: string[] = [];
		const parent = ticket('p');
		const child = ticket('c', { parentId: 'p' });
		const { store, list } = setup([parent, child], {
			update: async (id, patch, options) => {
				order.push(`${id}:${options?.completion ?? '-'}`);
				return {
					...(list.find(id) as TicketSummary),
					...patch,
					updated: nextUpdated()
				} as TicketSummary;
			}
		});

		await store.run({ kind: 'complete', withChildren: true }, ['p', 'c']);

		expect(order).toEqual(['c:-', 'p:-']);
	});

	it('takes open blocking sub-tasks along with the choice and restores them on undo', async () => {
		const { store, update, list } = setup([
			ticket('p', { status: 'in_progress' }),
			ticket('c1', { parentId: 'p', status: 'waiting' }),
			ticket('c2', { parentId: 'p', blocksParent: false })
		]);

		const result = await store.run({ kind: 'complete', withChildren: true }, ['p']);

		expect(update).toHaveBeenCalledExactlyOnceWith(
			'p',
			{ status: 'done' },
			{ completion: 'complete_children' }
		);
		expect(result?.counts.changed).toBe(1);
		const completed = list.find('p')?.updated;
		update.mockClear();
		await store.undo();
		expect(update).toHaveBeenCalledWith(
			'p',
			{ status: 'in_progress' },
			{ expectedUpdated: completed }
		);
		expect(update).toHaveBeenCalledWith('c1', { status: 'waiting' });
	});

	it('lists a ticket whose open sub-tasks block it when they are not taken along', async () => {
		const { store, update } = setup([ticket('p'), ticket('c', { parentId: 'p' })], {
			update: vi.fn(async () => {
				throw refusal(
					'status',
					'validation_parent_open_children',
					'Offene Unteraufgaben blockieren das Erledigen.',
					{
						count: 2,
						keys: ['HAUS-3', 'HAUS-4']
					}
				);
			})
		});

		const result = await store.run({ kind: 'complete', withChildren: false }, ['p']);

		expect(update).toHaveBeenCalledExactlyOnceWith('p', { status: 'done' }, {});
		expect(result?.failures).toEqual([
			{ id: 'p', key: 'HAUS-p', reason: '2 Unteraufgaben sind noch offen (HAUS-3, HAUS-4).' }
		]);
	});

	it('counts done tickets as unchanged and "Status: Erledigt" as "Erledigen"', async () => {
		const { store, update } = setup([ticket('1', { status: 'done' }), ticket('2')]);
		const result = await store.run({ kind: 'status', value: 'done' }, ['1', '2']);
		expect(update).toHaveBeenCalledExactlyOnceWith('2', { status: 'done' }, {});
		expect(result?.counts).toEqual({ changed: 1, skipped: 0, unchanged: 1, failed: 0 });
	});

	it('names the series whose next ticket was already edited when undo reopens (ADR-0023)', async () => {
		const { store, data } = setup([ticket('1', { recurring: true })]);
		await store.run({ kind: 'complete', withChildren: true }, ['1']);
		data.update = vi.fn(async () => {
			throw refusal(
				'status',
				'validation_recurrence_open_instance',
				'Von dieser Serie ist schon ein Ticket offen.'
			);
		});

		await store.undo();

		expect(store.result?.failures).toEqual([
			{ id: '1', key: 'HAUS-1', reason: 'Von dieser Serie ist schon ein Ticket offen.' }
		]);
	});
});

describe('BulkEditStore: "Löschen" and the session', () => {
	it('deletes with the chosen handling of the sources and takes the rows out', async () => {
		const { store, data, list } = setup([ticket('1'), ticket('2')]);
		await store.run({ kind: 'delete', sources: 'discard' }, ['1', '2']);
		expect(data.delete).toHaveBeenCalledWith('1', 'discard');
		expect(list.find('1')).toBeNull();
		expect(list.find('2')).toBeNull();
	});

	it('counts the sources for the question, null when that fails', async () => {
		const { store } = setup([ticket('1')], { sourceCount: vi.fn(async () => 3) });
		expect(await store.sourceCount(['1'])).toBe(3);
		const failing = setup([ticket('1')], {
			sourceCount: vi.fn(async () => {
				throw new DataError('network');
			})
		});
		expect(await failing.store.sourceCount(['1'])).toBeNull();
	});

	it('stops after an ended session: logout once, nothing more sent, no result', async () => {
		const tickets = Array.from({ length: 8 }, (_, index) => ticket(String(index + 1)));
		const { store, session, update } = setup(tickets, {
			update: vi.fn(async () => {
				throw new DataError('session');
			})
		});

		const result = await store.run(
			{ kind: 'priority', value: 'low' },
			tickets.map((entry) => entry.id)
		);

		expect(result).toBeNull();
		expect(session.logout).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledTimes(BULK_CONCURRENCY);
		expect(store.result).toBeNull();
	});

	it('does nothing without a session, without tickets or while another action runs', async () => {
		const { store, session, update } = setup([ticket('1')]);
		expect(await store.run({ kind: 'priority', value: 'low' }, [])).toBeNull();
		expect(await store.run({ kind: 'priority', value: 'low' }, ['unknown'])).toBeNull();
		session.ensureValid.mockReturnValueOnce(false);
		expect(await store.run({ kind: 'priority', value: 'low' }, ['1'])).toBeNull();
		expect(update).not.toHaveBeenCalled();
	});
});
