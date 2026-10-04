// TrashStore (ADR-0037, plan PB-2): loading with the hint before the migration (503), restoring
// with its notes and the inline questions (target project, leaving the series) that keep the
// choices made so far, deleting for good one by one, for the chosen rows and all at once, the
// retention, "Rückgängig" after deleting in the panel with expected_updated, and reading again
// when the server reports a change; since ADR-0047 blocked tickets (refused, kept when emptying)
// and the decisions of the decision help. Fake data layer; flags recorded.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RestoreResult, TrashItem, TrashPreview } from '$lib/domain/trash';
import type { FlagInput, FlagSink } from './flags.svelte';
import { TrashStore, needOf, type TrashData, type TrashLive } from './trash.svelte';

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
	return {
		id,
		key: `TASK-${id.slice(-1)}`,
		title: `Ticket ${id}`,
		status: 'open',
		priority: 'medium',
		due: '',
		project: null,
		recurring: false,
		children: 0,
		dependencies: 0,
		deletedAt: '2026-09-28 10:00:00.000Z',
		deletedBy: 'user00000000001',
		updated: '2026-09-28 10:00:00.000Z',
		daysLeft: 30,
		...overrides
	};
}

function result(id: string, overrides: Partial<RestoreResult> = {}): RestoreResult {
	return {
		id,
		key: `TASK-${id.slice(-1)}`,
		updated: '2026-09-28 11:00:00.000Z',
		tickets: [{ id, key: `TASK-${id.slice(-1)}` }],
		newKeys: [],
		parentDetached: false,
		ruleMissing: [],
		seriesDetached: [],
		sourcesSkipped: [],
		...overrides
	};
}

const A = 'ticket00000000a';
const B = 'ticket00000000b';

function projectNeed(): DataError {
	return new DataError('validation', {
		status: 400,
		fields: {
			project: {
				code: 'validation_trash_project_required',
				message: 'Bitte ein Zielprojekt wählen.',
				params: { code: 'HAUS', reason: 'missing', key: 'HAUS-1' }
			}
		}
	});
}

function seriesNeed(): DataError {
	return new DataError('validation', {
		status: 400,
		fields: {
			recurrence: {
				code: 'validation_trash_series_conflict',
				message: 'Die Serie hat schon ein offenes Ticket.',
				params: { key: 'TASK-9', ticket: 'ticket000000009' }
			}
		}
	});
}

function setup(overrides: Partial<TrashData> = {}, items = [item(A), item(B)]) {
	const shown: FlagInput[] = [];
	const flags: FlagSink = {
		show: vi.fn((input: FlagInput) => {
			shown.push(input);
			return String(shown.length);
		}),
		dismiss: vi.fn()
	};
	const data: TrashData = {
		list: vi.fn(async () => ({ items, retention: '30' as const })),
		preview: vi.fn(),
		restore: vi.fn(async (id: string) => result(id)),
		resolve: vi.fn(),
		purge: vi.fn(async () => undefined),
		purgeAll: vi.fn(async () => ({ purged: items.length, blocked: [] })),
		saveRetention: vi.fn(async (retention) => retention),
		...overrides
	};
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new TrashStore(data, session, flags);
	return { store, data, session, shown };
}

describe('TrashStore: loading', () => {
	it('loads the tickets and the retention and counts them', async () => {
		const { store } = setup();
		expect(store.count).toBeNull();
		await store.reload();
		expect(store.state).toBe('ready');
		expect(store.items.map((entry) => entry.id)).toEqual([A, B]);
		expect(store.count).toBe(2);
		expect(store.retention).toBe('30');
	});

	it('says "unavailable" before the migration (503) and "error" otherwise', async () => {
		const before = setup({
			list: vi.fn(async () => Promise.reject(new DataError('server', { status: 503 })))
		});
		await before.store.reload();
		expect(before.store.state).toBe('unavailable');
		const broken = setup({ list: vi.fn(async () => Promise.reject(new DataError('network'))) });
		await broken.store.reload();
		expect(broken.store.state).toBe('error');
		expect(broken.store.error).toMatch(/Server nicht erreichbar/);
	});

	it('reads again when the server reports a change or the connection comes back', async () => {
		const { store, data } = setup();
		let change = () => {};
		let back = () => {};
		const live: TrashLive = {
			changes: vi.fn(async (onChange) => {
				change = onChange;
				return async () => {};
			}),
			reconnected: vi.fn(async (callback) => {
				back = callback;
				return async () => {};
			})
		};
		const stop = store.connect(live);
		await vi.waitFor(() => expect(live.changes).toHaveBeenCalled());
		change();
		back();
		await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(2));
		stop();
	});

	it('logs out when the session ended', async () => {
		const { store, session } = setup({
			list: vi.fn(async () => Promise.reject(new DataError('session', { status: 401 })))
		});
		await store.reload();
		expect(session.logout).toHaveBeenCalled();
	});
});

describe('TrashStore: restoring', () => {
	it('removes the ticket, shows a flag and keeps notes worth knowing', async () => {
		const restore = vi.fn(async (id: string) =>
			result(id, {
				newKeys: [{ id, key: 'GART-4', previous: 'HAUS-1' }],
				sourcesSkipped: [{ id: 'item', title: 'Mail', reason: 'discarded', key: 'GART-4' }]
			})
		);
		const { store, shown } = setup({ restore });
		await store.reload();
		await store.restore(A);
		expect(restore).toHaveBeenCalledWith(A, {});
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(shown.at(-1)).toMatchObject({ tone: 'success', title: 'TASK-a wiederhergestellt.' });
		expect(shown.at(-1)?.description).toContain('HAUS-1 heißt jetzt GART-4.');
		expect(store.result?.notes).toEqual([
			'HAUS-1 heißt jetzt GART-4.',
			'Die Quelle „Mail“ blieb im Eingang: inzwischen verworfen.'
		]);
		expect(shown.at(-1)?.action).toBeUndefined();
	});

	it('offers "Öffnen" in the flag; the user stays in the trash (ADR-0054 §7)', async () => {
		const { store, shown } = setup();
		await store.reload();
		const open = vi.fn();
		await store.restore(A, {}, open);
		const flag = shown.at(-1);
		expect(flag).toMatchObject({ tone: 'success', title: 'TASK-a wiederhergestellt.' });
		expect(flag?.action?.label).toBe('Öffnen');
		expect(open).not.toHaveBeenCalled();
		flag?.action?.run();
		expect(open).toHaveBeenCalledExactlyOnceWith(A);
	});

	it('asks inline for a target project and a way out of the series, keeping earlier choices', async () => {
		const restore = vi
			.fn<TrashData['restore']>()
			.mockRejectedValueOnce(projectNeed())
			.mockRejectedValueOnce(seriesNeed())
			.mockImplementation(async (id) => result(id));
		const { store } = setup({ restore });
		await store.reload();

		expect(await store.restore(A)).toBeNull();
		expect(store.needOf(A)).toEqual({ kind: 'project', code: 'HAUS', reason: 'missing' });
		expect(store.items).toHaveLength(2);

		await store.restore(A, { project: '' });
		expect(store.needOf(A)).toEqual({ kind: 'series', key: 'TASK-9', ticketId: 'ticket000000009' });

		await store.restore(A, { detachSeries: true });
		expect(restore).toHaveBeenLastCalledWith(A, { project: '', detachSeries: true });
		expect(store.needOf(A)).toBeNull();
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
	});

	it('drops a question and its choices on "Abbrechen"', async () => {
		const restore = vi.fn<TrashData['restore']>().mockRejectedValueOnce(projectNeed());
		const { store } = setup({ restore });
		await store.reload();
		await store.restore(A, { project: 'p1' });
		store.dismissNeed(A);
		expect(store.needOf(A)).toBeNull();
		restore.mockImplementation(async (id) => result(id));
		await store.restore(A);
		expect(restore).toHaveBeenLastCalledWith(A, {});
	});

	it('shows any other failure as an error flag; a ticket gone from the trash leaves the list', async () => {
		const restore = vi
			.fn<TrashData['restore']>()
			.mockRejectedValueOnce(new DataError('network'))
			.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		const { store, shown } = setup({ restore });
		await store.reload();
		await store.restore(A);
		expect(shown.at(-1)).toMatchObject({ tone: 'error' });
		expect(shown.at(-1)?.title).toMatch(
			/TASK-a wurde nicht wiederhergestellt\. Server nicht erreichbar/
		);
		await store.restore(A);
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
	});

	it('reads a need only from its codes', () => {
		expect(needOf(projectNeed())).toMatchObject({ kind: 'project' });
		expect(needOf(seriesNeed())).toMatchObject({ kind: 'series', key: 'TASK-9' });
		expect(needOf(new DataError('validation', { status: 400, fields: {} }))).toBeNull();
	});
});

describe('TrashStore: deleting for good', () => {
	it('deletes one ticket and says so', async () => {
		const { store, data, shown } = setup();
		await store.reload();
		expect(await store.purge(A)).toBe(true);
		expect(data.purge).toHaveBeenCalledWith(A);
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(shown.at(-1)).toMatchObject({ tone: 'success', title: 'TASK-a endgültig gelöscht.' });
	});

	it('empties the trash', async () => {
		const { store, shown } = setup();
		await store.reload();
		expect(await store.purgeAll()).toBe(true);
		expect(store.items).toEqual([]);
		expect(shown.at(-1)?.title).toBe('Papierkorb geleert (2 Tickets).');
	});

	it('keeps blocked tickets when emptying and names them (ADR-0047)', async () => {
		const purgeAll = vi.fn(async () => ({
			purged: 1,
			blocked: [{ id: B, key: 'TASK-b', count: 2 }]
		}));
		const { store, shown } = setup({ purgeAll }, [item(A), item(B, { dependencies: 2 })]);
		await store.reload();
		expect(store.blockedCount).toBe(1);
		expect(await store.purgeAll()).toBe(true);
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(shown.at(-1)).toMatchObject({
			tone: 'success',
			title: 'Papierkorb geleert (1 Ticket).',
			description: '1 blockiertes Ticket bleibt: TASK-b. Bitte in der Vorschau entscheiden.'
		});

		purgeAll.mockResolvedValueOnce({ purged: 0, blocked: [{ id: B, key: 'TASK-b', count: 2 }] });
		await store.purgeAll();
		expect(shown.at(-1)).toMatchObject({ tone: 'info', title: 'Nichts gelöscht.' });
	});

	it('names the dependencies when deleting for good is refused (ADR-0047)', async () => {
		const purge = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					id: { code: 'validation_trash_blocked', message: 'Abhängigkeiten.', params: { count: 3 } }
				}
			});
		});
		const { store, shown } = setup({ purge });
		await store.reload();
		expect(await store.purge(A)).toBe(false);
		expect(store.items.map((entry) => entry.id)).toEqual([A, B]);
		expect(shown.at(-1)).toMatchObject({
			tone: 'error',
			title:
				'TASK-a wurde nicht gelöscht. Es hat noch 3 Abhängigkeiten. Bitte in der Vorschau entscheiden.'
		});
	});
});

describe('TrashStore: decision help (ADR-0047)', () => {
	function preview(id: string, dependencies: TrashPreview['dependencyList'] = []): TrashPreview {
		return {
			...item(id, { status: 'done', updated: '2026-09-28 12:00:00.000Z' }),
			description: '',
			tags: [],
			subtasks: [],
			group: '',
			sources: { handling: 'discard', count: 0 },
			dependencyList: dependencies
		};
	}

	it('sends the decisions, updates the row and says what happened', async () => {
		const resolve = vi.fn(async (id: string) => preview(id));
		const { store, data, shown } = setup({ resolve }, [item(A, { dependencies: 1 }), item(B)]);
		await store.reload();
		const actions = [{ action: 'complete' as const, ticket: A }];
		const result = await store.resolve(A, actions);
		expect(result).toMatchObject({ ok: true, value: { id: A } });
		expect(data.resolve).toHaveBeenCalledWith(A, actions);
		expect(store.find(A)).toMatchObject({
			status: 'done',
			dependencies: 0,
			updated: '2026-09-28 12:00:00.000Z'
		});
		expect(store.blockedCount).toBe(0);
		expect(shown.at(-1)).toMatchObject({ tone: 'success', title: 'Als erledigt markiert.' });
	});

	it('shows a refusal as a flag, except for a move, whose dialog shows it', async () => {
		const refusal = () =>
			new DataError('validation', {
				status: 400,
				fields: { ticket: { code: 'validation_scope_mismatch', message: 'Nicht verfügbar.' } }
			});
		const resolve = vi.fn(async () => {
			throw refusal();
		});
		const { store, shown } = setup({ resolve });
		await store.reload();
		expect(await store.resolve(A, [{ action: 'discard', item: 'item1' }])).toEqual({
			ok: false,
			message: 'Nicht verfügbar.'
		});
		expect(shown.at(-1)).toMatchObject({ tone: 'error' });
		const flags = shown.length;
		expect(await store.resolve(A, [{ action: 'move', item: 'item1', target: 'x' }])).toEqual({
			ok: false,
			message: 'Nicht verfügbar.'
		});
		expect(shown).toHaveLength(flags);
	});
});

describe('TrashStore: the chosen rows', () => {
	it('restores them one by one with progress, questions and failures', async () => {
		const restore = vi.fn(async (id: string) => {
			if (id === B) throw projectNeed();
			return result(id);
		});
		const C = 'ticket00000000c';
		const { store, shown } = setup({ restore }, [item(A), item(B), item(C)]);
		await store.reload();
		const running = store.runMany('restore', [A, B, C]);
		expect(store.progress).toMatchObject({ label: 'Wiederherstellen', total: 3 });
		await running;
		expect(store.progress).toBeNull();
		expect(store.needOf(B)).toMatchObject({ kind: 'project' });
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(shown.at(-1)?.title).toBe(
			'2 Tickets wiederhergestellt. 1 Ticket braucht noch eine Entscheidung.'
		);
	});

	it('deletes them for good and lists refusals', async () => {
		const purge = vi.fn(async (id: string) => {
			if (id === B) throw new DataError('server', { status: 500 });
		});
		const { store } = setup({ purge });
		await store.reload();
		await store.runMany('purge', [A, B]);
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(store.result?.failures).toEqual([
			{ id: B, key: 'TASK-b', reason: expect.stringMatching(/Server hat mit einem Fehler/) }
		]);
	});
});

describe('TrashStore: retention and "Rückgängig"', () => {
	it('saves the retention and puts it back on failure', async () => {
		const saveRetention = vi
			.fn<TrashData['saveRetention']>()
			.mockResolvedValueOnce('7')
			.mockRejectedValueOnce(new DataError('network'));
		const { store, shown } = setup({ saveRetention });
		await store.reload();
		// The setting of the account for its private trash (since E7-3 apart from the area's).
		expect(await store.setRetention('7')).toBe(true);
		expect(store.ownRetention).toBe('7');
		expect(shown.at(-1)?.title).toBe('Papierkorb: 7 Tage gespeichert.');
		expect(await store.setRetention('never')).toBe(false);
		expect(store.ownRetention).toBe('7');
		expect(shown.at(-1)).toMatchObject({ tone: 'error' });
	});

	it('keeps the retention of the area apart from the own one, and drops the old area at once (E7-3)', async () => {
		const list = vi
			.fn<TrashData['list']>()
			.mockResolvedValueOnce({ items: [item(A)], retention: '90', ownRetention: '7' })
			.mockResolvedValueOnce({ items: [item(B)], retention: '7', ownRetention: '7' });
		const { store } = setup({ list });
		await store.reload();
		expect(store.retention).toBe('90');
		expect(store.ownRetention).toBe('7');

		store.rescope();
		expect(store.items).toEqual([]);
		expect(store.state).toBe('loading');
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.items.map((entry) => entry.id)).toEqual([B]);
		expect(store.retention).toBe('7');
	});

	it('offers "Rückgängig" and restores with expected_updated', async () => {
		const { store, data, shown } = setup();
		const move = {
			id: A,
			updated: '2026-09-28 10:00:00.000Z',
			tickets: [{ id: A, key: 'TASK-a', updated: '2026-09-28 10:00:00.000Z' }]
		};
		store.offerUndo(move, 'TASK-a in den Papierkorb verschoben.');
		expect(shown.at(-1)).toMatchObject({
			tone: 'success',
			title: 'TASK-a in den Papierkorb verschoben.'
		});
		shown.at(-1)?.action?.run();
		await vi.waitFor(() =>
			expect(data.restore).toHaveBeenCalledWith(A, { expectedUpdated: move.updated })
		);
		await vi.waitFor(() => expect(shown.at(-1)?.title).toBe('TASK-a wiederhergestellt.'));
	});

	it('names a refused "Rückgängig" and never overwrites', async () => {
		const restore = vi.fn<TrashData['restore']>().mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					id: {
						code: 'validation_trash_stale',
						message: 'Das Ticket wurde inzwischen wiederhergestellt oder geändert.'
					}
				}
			})
		);
		const { store, shown } = setup({ restore });
		const move = { id: A, updated: 'x', tickets: [{ id: A, key: 'TASK-a', updated: 'x' }] };
		expect(await store.undo(move)).toBe(false);
		expect(shown.at(-1)).toMatchObject({ tone: 'error' });
		expect(shown.at(-1)?.title).toMatch(/inzwischen wiederhergestellt oder geändert/);
	});
});
