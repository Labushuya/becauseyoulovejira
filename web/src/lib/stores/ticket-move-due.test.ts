// Moving the due date of a ticket in the calendar (ADR-0053 §12, package K-2): the list store saves
// with expected_updated, shows the flag with "Rückgängig" and, for a ticket of a series, the note
// that the series does not move; a ticket changed meanwhile is not overwritten.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DescriptionGuard } from '$lib/data/tickets';
import { SERIES_MOVE_HINT } from '$lib/domain/calendar';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from './flags.svelte';
import { TicketListStore, type TicketListData } from './ticket-list.svelte';

const BEFORE = '2026-10-01 08:00:00.000Z';
const SAVED = '2026-10-02 09:00:00.000Z';
const RESTORED = '2026-10-02 09:00:05.000Z';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 't00000000000001',
		key: 'HAUS-12',
		title: 'Heizung entlüften',
		status: 'open',
		priority: 'medium',
		due: '2026-10-05',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: BEFORE,
		...overrides
	};
}

/** The hook refuses a change based on an older `updated` (ADR-0032 section 6). */
function staleError(): DataError {
	return new DataError('validation', {
		status: 400,
		fields: {
			description: {
				code: 'validation_description_stale',
				message: 'Die Beschreibung wurde inzwischen geändert.'
			}
		}
	});
}

function setup(tickets: TicketSummary[] = [ticket()]) {
	const stored = new Map(tickets.map((item) => [item.id, item]));
	let stamps = [SAVED, RESTORED];
	const update = vi.fn(
		async (id: string, patch: TicketPatch, options?: DescriptionGuard): Promise<TicketSummary> => {
			const current = stored.get(id);
			if (current === undefined) throw new DataError('not_found');
			if (options?.expectedUpdated !== undefined && options.expectedUpdated !== current.updated) {
				throw staleError();
			}
			const [stamp = SAVED, ...rest] = stamps;
			stamps = rest;
			const next = {
				...current,
				...(patch.due !== undefined && { due: patch.due }),
				updated: stamp
			};
			stored.set(id, next);
			return next;
		}
	);
	const data = {
		listOpen: vi.fn(async () => tickets),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(),
		update
	} satisfies TicketListData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	const store = new TicketListStore(data, session, { flags });
	store.loadOpen();
	return { store, flags, update, stored, session };
}

async function loaded(context: ReturnType<typeof setup>) {
	await vi.waitFor(() => expect(context.store.openState).toBe('ready'));
	return context;
}

function shown(flags: FlagStore) {
	return flags.flags.map((flag) => ({
		tone: flag.tone,
		title: flag.title,
		description: flag.description,
		action: flag.action?.label ?? null
	}));
}

describe('moving the due date (calendar, K-2)', () => {
	it('saves with expected_updated, moves the ticket and offers "Rückgängig"', async () => {
		const { store, flags, update } = await loaded(setup());

		await expect(store.moveDue('t00000000000001', '2026-10-09')).resolves.toBe(true);

		expect(update).toHaveBeenCalledWith(
			't00000000000001',
			{ due: '2026-10-09' },
			{ expectedUpdated: BEFORE }
		);
		expect(store.find('t00000000000001')?.due).toBe('2026-10-09');
		expect(shown(flags)).toEqual([
			{
				tone: 'success',
				title: 'Fälligkeit von HAUS-12 auf 09.10.2026 gesetzt.',
				description: '',
				action: 'Rückgängig'
			}
		]);
	});

	it('restores the date before with "Rückgängig", again with expected_updated', async () => {
		const { store, flags, update } = await loaded(setup());
		await store.moveDue('t00000000000001', '2026-10-09');

		flags.act(flags.flags[0]?.id ?? '');
		await vi.waitFor(() => expect(store.find('t00000000000001')?.due).toBe('2026-10-05'));

		expect(update).toHaveBeenLastCalledWith(
			't00000000000001',
			{ due: '2026-10-05' },
			{ expectedUpdated: SAVED }
		);
		expect(shown(flags)).toEqual([
			{
				tone: 'success',
				title: 'Fälligkeit von HAUS-12 wieder auf 05.10.2026 gesetzt.',
				description: '',
				action: null
			}
		]);
	});

	it('adds for a ticket of a series that the series does not move', async () => {
		const { store, flags } = await loaded(setup([ticket({ recurring: true })]));

		await store.moveDue('t00000000000001', '2026-10-07');

		expect(shown(flags)[0]?.description).toBe(SERIES_MOVE_HINT);
		expect(SERIES_MOVE_HINT).toBe(
			'Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.'
		);
	});

	it('does not overwrite a ticket changed meanwhile and says so', async () => {
		const context = await loaded(setup());
		const { store, flags, stored } = context;
		// Another tab changed the ticket; this tab has not heard of it yet.
		stored.set('t00000000000001', { ...ticket(), title: 'Anders', updated: SAVED });

		await expect(store.moveDue('t00000000000001', '2026-10-09')).resolves.toBe(false);

		expect(store.find('t00000000000001')?.due).toBe('2026-10-05');
		expect(store.isPending('t00000000000001')).toBe(false);
		expect(shown(flags)).toEqual([
			{
				tone: 'error',
				title: 'Fälligkeit von HAUS-12 nicht gesetzt: Das Ticket wurde inzwischen geändert.',
				description: '',
				action: null
			}
		]);
	});

	it('does not undo over a change made after the move', async () => {
		const { store, flags, stored } = await loaded(setup());
		await store.moveDue('t00000000000001', '2026-10-09');
		const moved = stored.get('t00000000000001');
		if (moved === undefined) throw new Error('ticket missing');
		stored.set(moved.id, { ...moved, updated: '2026-10-02 10:00:00.000Z' });

		flags.act(flags.flags[0]?.id ?? '');
		await vi.waitFor(() => expect(flags.flags[0]?.tone).toBe('error'));

		expect(flags.flags[0]?.title).toBe(
			'Fälligkeit von HAUS-12 nicht zurückgesetzt: Das Ticket wurde inzwischen geändert.'
		);
		expect(store.find('t00000000000001')?.due).toBe('2026-10-09');
	});

	it('closes the flag of a first move when the ticket moves again', async () => {
		const { store, flags } = await loaded(setup());
		await store.moveDue('t00000000000001', '2026-10-09');
		await store.moveDue('t00000000000001', '2026-10-12');

		expect(shown(flags).map((flag) => flag.title)).toEqual([
			'Fälligkeit von HAUS-12 auf 12.10.2026 gesetzt.'
		]);
	});

	it('moves nothing that is done, unknown, pending, on the same day or without a session', async () => {
		const done = ticket({ id: 't00000000000002', key: 'HAUS-13', status: 'done' });
		const context = await loaded(setup([ticket(), done]));
		const { store, update, session } = context;

		await expect(store.moveDue('t00000000000002', '2026-10-09')).resolves.toBe(false);
		await expect(store.moveDue('t00000000000009', '2026-10-09')).resolves.toBe(false);
		await expect(store.moveDue('t00000000000001', '2026-10-05')).resolves.toBe(false);
		const first = store.moveDue('t00000000000001', '2026-10-09');
		await expect(store.moveDue('t00000000000001', '2026-10-10')).resolves.toBe(false);
		await first;
		expect(update).toHaveBeenCalledOnce();

		session.ensureValid.mockReturnValue(false);
		await expect(store.moveDue('t00000000000001', '2026-10-11')).resolves.toBe(false);
		expect(update).toHaveBeenCalledOnce();
	});

	it('names another refusal of the server with the message of its field', async () => {
		const context = await loaded(setup());
		context.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { due: { code: 'validation_invalid_date', message: 'Kein gültiges Datum.' } }
			})
		);

		await expect(context.store.moveDue('t00000000000001', '2026-10-09')).resolves.toBe(false);

		expect(shown(context.flags)).toEqual([
			{
				tone: 'error',
				title: 'Fälligkeit von HAUS-12 konnte nicht gesetzt werden. Kein gültiges Datum.',
				description: '',
				action: null
			}
		]);
	});
});
