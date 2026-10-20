// The fields of the outbox in the data layer (OF-2, ADR-0074 §2 to §4): an update sends `op_id`,
// `client_at`, `offline` and `expected` only when the outbox names them; without, the body is the
// one of before. The history asks for `offline` and `device_at` only once the server reported
// `offline_ops`, and the capability is read from the answer of GET /api/byl/tickets/create.

import type PocketBase from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCreateSupport } from '$lib/domain/ticket-create';
import { HISTORY_FIELDS, listHistory, toHistoryEntry, type HistoryRecord } from './history';
import { OFFLINE_HISTORY_FIELDS, askOfflineMarks, historyFields } from './history-marks';
import { updateTicket, type TicketRecord } from './tickets';

const OP = 'aaaaaaaaaaaaaaaaaaaa';

const RECORD: TicketRecord = {
	id: 'tick00000000001',
	key: 'HAUS-12',
	title: 'Müll rausbringen',
	status: 'done',
	priority: 'medium',
	due: '',
	project: '',
	tags: [],
	recurrence: '',
	completed_at: '2026-10-20 12:31:00.000Z',
	created: '2026-10-01 08:00:00.000Z',
	updated: '2026-10-20 12:31:00.000Z'
};

type Update = (id: string, body: object, options: unknown) => Promise<TicketRecord>;

function client() {
	const update = vi.fn<Update>(async () => RECORD);
	const getFullList = vi.fn(async () => []);
	const pb = {
		collection: () => ({ update, getFullList }),
		filter: (raw: string) => raw
	} as unknown as PocketBase;
	return { pb, update, getFullList };
}

afterEach(() => askOfflineMarks(false));

describe('updateTicket', () => {
	it('sends the body of before without the fields of the outbox', async () => {
		const { pb, update } = client();
		await updateTicket(pb, RECORD.id, { status: 'done' }, { completion: 'force' });
		expect(update.mock.calls[0]?.[1]).toEqual({ status: 'done', force: true });
	});

	it('sends the identifier, the time of the device and the value before of the outbox', async () => {
		const { pb, update } = client();
		const clientAt = '2026-10-20T12:03:00.000Z';
		const expected = { status: 'open' };
		const timed = { opId: OP, clientAt, expected };
		await updateTicket(pb, RECORD.id, { status: 'done' }, { outbox: timed });
		expect(update.mock.calls[0]?.[1]).toEqual({
			status: 'done',
			op_id: OP,
			client_at: clientAt,
			expected
		});
		const late = { opId: OP, offline: true };
		await updateTicket(pb, RECORD.id, { status: 'done' }, { outbox: late });
		expect(update.mock.calls[1]?.[1]).toEqual({ status: 'done', op_id: OP, offline: true });
	});
});

describe('the history', () => {
	it('asks for the fields of before until the server reports the outbox', async () => {
		const { pb, getFullList } = client();
		expect(historyFields()).toBe(HISTORY_FIELDS);
		await listHistory(pb, RECORD.id);
		const before = expect.objectContaining({ fields: HISTORY_FIELDS });
		expect(getFullList.mock.calls[0]).toEqual([before]);
		askOfflineMarks(true);
		await listHistory(pb, RECORD.id);
		const after = expect.objectContaining({ fields: OFFLINE_HISTORY_FIELDS });
		expect(getFullList.mock.calls[1]).toEqual([after]);
	});

	it('keeps the form of an entry without the mark and names the time of the device of one with it', () => {
		const base: HistoryRecord = {
			id: 'h1',
			ticket: RECORD.id,
			field: 'status',
			old_value: 'open',
			new_value: 'done',
			user: 'user00000000001',
			created: '2026-10-20 12:30:00.000Z'
		};
		expect(toHistoryEntry({ ...base, offline: false, device_at: '' })).toEqual({
			id: 'h1',
			ticket: RECORD.id,
			field: 'status',
			oldValue: 'open',
			newValue: 'done',
			user: 'user00000000001',
			created: '2026-10-20 12:30:00.000Z'
		});
		const deviceAt = '2026-10-20 12:03:00.000Z';
		const marked = toHistoryEntry({ ...base, offline: true, device_at: deviceAt });
		expect(marked).toMatchObject({ offline: true, deviceAt });
		expect(toHistoryEntry({ ...base, offline: true, device_at: '' }).deviceAt).toBeNull();
	});
});

describe('the capability in the answer of "Neues Ticket"', () => {
	it('is left out while the server does not name offline_ops (before the restart after OF-1)', () => {
		expect(toCreateSupport({ subtask_status: true })).not.toHaveProperty('offlineOps');
		expect(toCreateSupport({ offline_ops: null })?.offlineOps).toBeNull();
		const ops = { version: 1, kinds: ['ticket.update'] };
		expect(toCreateSupport({ offline_ops: ops })?.offlineOps).toEqual(ops);
	});
});
