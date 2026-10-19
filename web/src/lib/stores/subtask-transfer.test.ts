// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070), the store of the (app) layout on a fake data
// layer: whether the server knows the route (from GET /api/byl/tickets/create, before the restart the
// hint), the flag after a transfer, the remembered fields of a device (never the project, blocked
// storage without breaking anything), and every refusal as a message: 409, a sub-task a hook refused
// with its key, a parent that is gone, a server without the route.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	NO_TRANSFER_FIELDS,
	SUBTASK_TRANSFER_STORAGE_KEY,
	type TransferOutcome,
	type TransferRequest
} from '$lib/domain/subtask-transfer';
import type { CreateSupport } from '$lib/domain/ticket-create';
import type { FlagInput } from './flags.svelte';
import {
	SubtaskTransferStore,
	type SubtaskTransferData,
	type TransferSupportSource
} from './subtask-transfer.svelte';

const PARENT = { id: 'parent000000001', key: 'HAUS-12' };
const REQUEST: TransferRequest = {
	expectedUpdated: '2026-10-02 10:00:00.000Z',
	fields: { ...NO_TRANSFER_FIELDS, priority: true },
	targets: 'open'
};
const OUTCOME: TransferOutcome = {
	parent: PARENT,
	changed: 3,
	unchanged: 1,
	tickets: []
};

function memoryWindow(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value)
	};
	return { win: { localStorage } as unknown as Window, values };
}

function setup(
	transfer: SubtaskTransferData['transfer'] = async () => OUTCOME,
	{ support = null as TransferSupportSource | null, win = null as Window | null } = {}
) {
	const flags: FlagInput[] = [];
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const data = { transfer: vi.fn(transfer) };
	const store = new SubtaskTransferStore(
		data,
		session,
		{ show: (input) => (flags.push(input), 'flag'), dismiss: vi.fn() },
		support,
		win
	);
	return { store, data, flags, session };
}

const SUPPORT: CreateSupport = {
	recurrence: true,
	pin: true,
	dayPlan: true,
	ticketSources: true,
	kind: true,
	color: true,
	charm: true,
	assignee: true,
	subtaskStatus: true,
	duplicateSubtaskStatus: true,
	subtaskTransfer: true
};

function source(overrides: Partial<TransferSupportSource> = {}): TransferSupportSource {
	return {
		createSupport: SUPPORT,
		createSupportProblem: null,
		createSupportLoading: false,
		loadCreateSupport: vi.fn(async () => undefined),
		...overrides
	};
}

/** An error of the SDK as it arrives at the data layer (status and answer). */
function sdkError(status: number, data: Record<string, unknown> = {}) {
	return Object.assign(new Error(`status ${status}`), {
		status,
		response: { status, message: '', data },
		isAbort: false
	});
}

describe('whether the server knows the route', () => {
	it('follows the answer of GET /api/byl/tickets/create', () => {
		expect(setup(undefined, { support: source() }).store.support).toBe('ready');
		expect(
			setup(undefined, {
				support: source({ createSupport: { ...SUPPORT, subtaskTransfer: false } })
			}).store.support
		).toBe('missing');
		// Before the restart after NT-1 the route of the question itself is missing.
		expect(setup(undefined, { support: source({ createSupport: null }) }).store.support).toBe(
			'missing'
		);
		expect(setup(undefined, { support: source({ createSupport: undefined }) }).store.support).toBe(
			'pending'
		);
		const failed = setup(undefined, {
			support: source({
				createSupport: undefined,
				createSupportProblem: 'Server nicht erreichbar.'
			})
		}).store;
		expect(failed.support).toBe('failed');
		expect(failed.supportProblem).toBe('Server nicht erreichbar.');
	});

	it('asks again on every opening', async () => {
		const support = source();
		await setup(undefined, { support }).store.loadSupport();
		expect(support.loadCreateSupport).toHaveBeenCalledOnce();
	});
});

describe('transfer', () => {
	it('sends the request and shows the flag with the number of changed sub-tasks', async () => {
		const { store, data, flags } = setup();
		const result = await store.transfer(PARENT, REQUEST, ['priority']);
		expect(result).toEqual({ ok: true, outcome: OUTCOME });
		expect(data.transfer).toHaveBeenCalledExactlyOnceWith(PARENT.id, REQUEST);
		expect(flags).toEqual([{ tone: 'success', title: 'Auf 3 Unteraufgaben übertragen.' }]);
	});

	it('remembers the confirmed fields on this device, never the project', async () => {
		const { win, values } = memoryWindow();
		const { store } = setup(undefined, { win });
		expect(store.rememberedFields).toEqual(['due', 'priority']);
		await store.transfer(PARENT, REQUEST, ['project', 'status', 'tags']);
		expect(values.get(SUBTASK_TRANSFER_STORAGE_KEY)).toBe('["status","tags"]');
		expect(store.rememberedFields).toEqual(['status', 'tags']);
		// Another tab (or the next opening) reads it from the storage.
		expect(setup(undefined, { win }).store.rememberedFields).toEqual(['status', 'tags']);
	});

	it('keeps the choice for the page when the storage is blocked', async () => {
		const blocked = {
			get localStorage(): Storage {
				throw new Error('blocked');
			}
		} as unknown as Window;
		const { store, flags } = setup(undefined, { win: blocked });
		await store.transfer(PARENT, REQUEST, ['status']);
		expect(flags).toHaveLength(1);
		expect(store.rememberedFields).toEqual(['status']);
	});

	it('remembers nothing after a refusal', async () => {
		const { win, values } = memoryWindow();
		const { store } = setup(
			async () => Promise.reject(new DataError('forbidden', { status: 403 })),
			{
				win
			}
		);
		await store.transfer(PARENT, REQUEST, ['status']);
		expect(values.has(SUBTASK_TRANSFER_STORAGE_KEY)).toBe(false);
	});

	it('says that the ticket changed meanwhile (409)', async () => {
		const { store, flags } = setup(async () => Promise.reject(sdkError(409)));
		expect(await store.transfer(PARENT, REQUEST, ['priority'])).toEqual({
			ok: false,
			message: 'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.',
			missing: false,
			stale: true,
			// "Details" of the message (FP-1): the intent and the answer of the route.
			problem: expect.objectContaining({
				intent: 'Unteraufgaben übertragen',
				outcome: expect.objectContaining({ result: 'response', status: 409 })
			})
		});
		expect(flags).toEqual([]);
	});

	it('names the sub-task a hook refused, with the text of its code', async () => {
		const { store } = setup(async () =>
			Promise.reject(
				sdkError(400, {
					targets: {
						code: 'validation_project_archived',
						message: 'GART-3: Das Projekt ist archiviert.',
						params: { id: 'child0000000003', key: 'GART-3', field: 'project' }
					}
				})
			)
		);
		expect(await store.transfer(PARENT, REQUEST, ['project'])).toEqual({
			ok: false,
			message: 'GART-3: Das Projekt ist archiviert.',
			missing: false,
			problem: expect.objectContaining({
				outcome: expect.objectContaining({ code: 'targets: validation_project_archived' })
			})
		});
	});

	it('says why a request is refused without a sub-task, and when the ticket is gone', async () => {
		const tags = setup(async () =>
			Promise.reject(sdkError(400, { tags: { code: 'validation_transfer_tags', message: 'x' } }))
		).store;
		expect((await tags.transfer(PARENT, REQUEST, ['tags'])).ok).toBe(false);
		expect(await tags.transfer(PARENT, REQUEST, ['tags'])).toMatchObject({
			message:
				'Tags: hinzufügen nur Tags des Haupttickets, entfernen nur Tags, die es nicht hat, je höchstens 100.'
		});
		const gone = setup(async () =>
			Promise.reject(new DataError('not_found', { status: 404 }))
		).store;
		expect(await gone.transfer(PARENT, REQUEST, ['priority'])).toMatchObject({
			message: 'Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.'
		});
	});

	it('reports a server without the route as missing, without a message (before the restart)', async () => {
		const { store, flags } = setup(async () => null);
		expect(await store.transfer(PARENT, REQUEST, ['priority'])).toEqual({
			ok: false,
			message: null,
			missing: true
		});
		expect(flags).toEqual([]);
	});

	it('sends nothing without a session and logs out when it ended', async () => {
		const none = setup();
		none.session.ensureValid.mockReturnValue(false);
		expect(await none.store.transfer(PARENT, REQUEST, ['priority'])).toMatchObject({ ok: false });
		expect(none.data.transfer).not.toHaveBeenCalled();
		const ended = setup(async () => Promise.reject(new DataError('session', { status: 401 })));
		expect(await ended.store.transfer(PARENT, REQUEST, ['priority'])).toEqual({
			ok: false,
			message: null,
			missing: false
		});
		expect(ended.session.logout).toHaveBeenCalledOnce();
	});
});
