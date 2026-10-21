// "＋" without a connection (OF-4a, ADR-0074 addendum OF-4a) on the scaffold of the outbox
// ($lib/test/outbox-fake.ts, whose server creates as the hooks do): a ticket or an entry of the inbox
// under an ID of the client, kept and shown until the server has it, sent once with its identifier
// (a repetition creates nothing more), changes of the ticket taken into the creation or waiting for
// it, and "Verwerfen" before, while and after the creation may have left the device (C1 to C4).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	KEEP_MS,
	OFFLINE_TEXTS,
	isCreateAction,
	isTicketCreate,
	type KeptAction
} from '$lib/domain/offline';
import type { TicketDraft } from '$lib/domain/ticket';
import {
	ALL_OPS,
	NOW,
	OPS,
	goOffline,
	goOnline,
	harness,
	settle,
	type Harness
} from '$lib/test/outbox-fake';

/** The ID and the identifier `letters()` draws first: the ID, then the identifier. */
const ID = 'aaaaaaaaaaaaaaa';
const OP = 'bbbbbbbbbbbbbbbbbbbb';
const PROJECT = 'proj00000000001';
const TAG = 'tagg00000000001';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
	const h = harness({ support: ALL_OPS, ...options });
	h.server.strict = true;
	await settle();
	return h;
}

function draft(overrides: Partial<TicketDraft> = {}): TicketDraft {
	return {
		title: 'Zahnarzt anrufen',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: [],
		...overrides
	};
}

const ITEM_DRAFT = { title: 'Milch kaufen', project: null, tags: [], priority: null };

function only(h: Harness): KeptAction {
	expect(h.outbox.actions).toHaveLength(1);
	return h.outbox.actions[0] as KeptAction;
}

/** The requests that created something on the server, per ID. */
function records(h: Harness): string[] {
	return [...h.server.records.keys()];
}

/** The next request of a creation does not reach the server: no answer, nothing written. */
function unreached(h: Harness): void {
	h.sendCreate.mockRejectedValueOnce(new DataError('network'));
}

describe('"＋" as a ticket (OF-4a)', () => {
	it('goes at once with a connection, under an ID of the client and only its identifier', async () => {
		const h = await ready();
		const created = await h.outbox.createTicket(draft());
		expect(created.kept).toBe(false);
		expect(created.value).toMatchObject({ id: ID, key: 'TASK-1', title: 'Zahnarzt anrufen' });
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(h.sendCreate.mock.calls[0]?.[0]).toMatchObject({ target: ID, kind: 'ticket.create' });
		expect(h.sendCreate.mock.calls[0]?.[1]).toEqual({ opId: OP });
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.createdTickets()).toEqual([]);
	});

	it('is kept without a connection, shown as "Neu" with its mark, and created once it is back', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft({ project: PROJECT, tags: [TAG] }));
		expect(created.kept).toBe(true);
		expect(created.value).toMatchObject({ id: ID, key: '', projectId: PROJECT, tagIds: [TAG] });
		expect(h.sendCreate).not.toHaveBeenCalled();
		expect(h.outbox.createdTickets().map((ticket) => ticket.id)).toEqual([ID]);
		expect(h.outbox.createdTicket(ID)?.title).toBe('Zahnarzt anrufen');
		expect(h.outbox.markOf(ID)).toBe('pending');
		expect(h.outbox.isCreatedView(created.value)).toBe(true);

		await goOnline(h);
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(h.sendCreate.mock.calls[0]?.[1]).toEqual({
			opId: OP,
			clientAt: new Date(NOW).toISOString()
		});
		expect(h.server.records.get(ID)).toMatchObject({
			key: 'TASK-1',
			project: PROJECT,
			tags: [TAG]
		});
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.createdTicket(ID)).toBeNull();
		// The record of the server shows under the same ID, and it counts as read (ADR-0015 §3).
		expect(h.sink.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: ID, key: 'TASK-1' }));
		expect(h.sink.markRead).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
		expect(h.flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: OFFLINE_TEXTS.sent(1)
		});
	});

	it('shows the record of the server before the creation goes: no gap under its ID', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		let shownWhileKept = false;
		h.sink.upsert.mockImplementation(() => {
			if (h.outbox.actions.some((action) => action.target === ID)) shownWhileKept = true;
		});
		await goOnline(h);
		expect(shownWhileKept).toBe(true);
	});

	it('creates one ticket with one key when the answer got lost and it is sent again (C1)', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		expect(only(h)).toMatchObject({ unanswered: true });
		// The answer was lost: the worker sends again under the same identifier, the server answers like
		// the first time and draws no new number.
		await goOffline(h);
		await goOnline(h);
		expect(h.server.sent.filter((op) => op === OP)).toHaveLength(2);
		expect(records(h)).toEqual([ID]);
		expect(h.server.counter).toBe(1);
		expect(h.outbox.count).toBe(0);
	});

	it('keeps it as "may have arrived" after a 5xx and creates it once later (C1)', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.sendCreate.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(only(h)).toMatchObject({ unanswered: true, attempts: 1 });
		await vi.advanceTimersByTimeAsync(3_000);
		expect(records(h)).toEqual([ID]);
		expect(h.server.counter).toBe(1);
		expect(h.outbox.count).toBe(0);
	});

	it('takes a change of its status and due date into the creation while it never left the device', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		const done = await h.outbox.changeStatus(created.value, { status: 'in_progress' });
		expect(done).toMatchObject({ id: ID, status: 'in_progress', key: '' });
		await h.outbox.changeDue(done, '2026-10-22');
		const action = only(h);
		expect(isTicketCreate(action) && action.payload).toMatchObject({
			status: 'in_progress',
			due: '2026-10-22'
		});
		expect(h.outbox.createdTicket(ID)).toMatchObject({ status: 'in_progress', due: '2026-10-22' });
		await goOnline(h);
		expect(h.server.status.get(ID)).toBe('in_progress');
		expect(h.server.due.get(ID)).toBe('2026-10-22');
		expect(h.send).not.toHaveBeenCalled();
		expect(h.sendDue).not.toHaveBeenCalled();
	});

	it('lets a change wait for a creation that may have arrived, based on the status it creates', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		expect(only(h)).toMatchObject({ sent: true, unanswered: true });
		const view = h.outbox.createdTicket(ID) ?? created.value;
		await h.outbox.changeStatus(view, { status: 'done' });
		await h.outbox.changeDue(h.outbox.createdTicket(ID) ?? view, '2026-10-23');
		const [, status, due] = h.outbox.actions;
		expect(status).toMatchObject({
			kind: 'ticket.update',
			dependsOn: [OP],
			payload: { status: 'done' },
			expected: { status: 'open' }
		});
		expect(due).toMatchObject({ dependsOn: [OP], payload: { due: '2026-10-23' } });
		expect(h.outbox.createdTicket(ID)).toMatchObject({ status: 'done', due: '2026-10-23' });
		await goOnline(h);
		expect(h.server.status.get(ID)).toBe('done');
		expect(h.server.due.get(ID)).toBe('2026-10-23');
		expect(records(h)).toEqual([ID]);
		expect(h.outbox.count).toBe(0);
	});

	it('answers a change with the creation as the views show it, never as a ticket of the server', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		const done = await h.outbox.changeStatus(created.value, { status: 'done' });
		expect(done.status).toBe('done');
		expect(h.outbox.isCreatedView(done)).toBe(true);
	});

	it('is not offered without the capability of the server or outside of the frame', async () => {
		const without = await ready({ support: OPS });
		expect(without.outbox.takes('ticket')).toBe(false);
		expect(without.outbox.takes('inbox')).toBe(false);
		const outside = await ready({ frame: false });
		expect(outside.outbox.takes('ticket')).toBe(false);
		const inside = await ready();
		expect(inside.outbox.takes('ticket')).toBe(true);
		expect(inside.outbox.takes('inbox')).toBe(true);
	});

	it('refuses the first attempt with a connection like today: nothing stays', async () => {
		const h = await ready();
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await expect(h.outbox.createTicket(draft({ project: PROJECT }))).rejects.toBeInstanceOf(
			DataError
		);
		expect(h.outbox.count).toBe(0);
		expect(h.server.counter).toBe(0);
	});
});

describe('a refused creation (OF-4a, C2, concept §3.7)', () => {
	it('keeps the whole title to be seen until the user decides, and "Ohne Projekt anlegen" creates it', async () => {
		const h = await ready();
		await goOffline(h);
		const title = 'Ein langer Titel, der nicht verloren gehen darf';
		await h.outbox.createTicket(draft({ title, project: PROJECT }));
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await goOnline(h);
		const refused = only(h);
		expect(refused).toMatchObject({ state: 'refused', title, outcome: { field: 'project' } });
		expect(h.outbox.createdTicket(ID)?.title).toBe(title);
		expect(h.outbox.markOf(ID)).toBe('decision');
		expect(h.server.counter).toBe(0);

		h.server.refuseCreate = null;
		await h.outbox.createWithout(refused.op, 'project');
		await settle();
		expect(h.server.records.get(ID)).toMatchObject({ project: null, title });
		expect(h.server.counter).toBe(1);
		expect(h.outbox.count).toBe(0);
	});

	it('names a taken ID in German and creates nothing (C1)', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.status.set(ID, 'open');
		await goOnline(h);
		expect(only(h)).toMatchObject({
			state: 'refused',
			outcome: {
				code: 'validation_not_unique',
				message: 'Die ID des neuen Eintrags ist auf dem Server schon vergeben.'
			}
		});
		expect(h.server.counter).toBe(0);
	});

	it('lets a change behind a refused creation wait, and both go with "Verwerfen"', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft({ project: PROJECT }));
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.createdTicket(ID) ?? created.value, { status: 'done' });
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await goOnline(h);
		expect(h.outbox.actions.map((action) => action.state)).toEqual(['refused', 'queued']);
		expect(h.send).not.toHaveBeenCalled();
		await h.outbox.discard(OP);
		expect(h.outbox.count).toBe(0);
		expect(h.send).not.toHaveBeenCalled();
		expect(records(h)).toEqual([]);
	});
});

describe('"Verwerfen" of a creation (OF-4a, C4)', () => {
	it('never sends one that never left the device; "Rückgängig" brings it back with its changes', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		await h.outbox.discard(OP);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.createdTickets()).toEqual([]);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('Neues Ticket „Zahnarzt anrufen“ verworfen.');
		expect(flag?.description).toBeUndefined();
		flag?.action?.run();
		await settle();
		expect(h.outbox.createdTicket(ID)).not.toBeNull();
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.server.sent).not.toContain(OP);
		expect(records(h)).toEqual([]);
	});

	it('does not send one again that may have arrived, looks it up, and names it with a link when it is there', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		expect(only(h)).toMatchObject({ unanswered: true });
		const sentBefore = h.sendCreate.mock.calls.length;
		await h.outbox.discard(OP);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.description).toBe(OFFLINE_TEXTS.createCheckHint);
		expect(h.outbox.createdTickets()).toEqual([]);
		expect(only(h)).toMatchObject({ discarded: true });

		await goOnline(h);
		expect(h.sendCreate.mock.calls.length).toBe(sentBefore);
		expect(h.get).toHaveBeenCalledWith(ID, expect.anything());
		expect(h.outbox.count).toBe(0);
		// Never deleted on the server: the notice names it with its key and a link.
		expect(records(h)).toEqual([ID]);
		expect(h.outbox.notices).toEqual([
			{
				id: `created-${OP}`,
				text: 'Das verworfene Ticket „Zahnarzt anrufen“ wurde schon angelegt (TASK-1). Bitte im Ticket prüfen und bei Bedarf löschen.',
				link: { record: 'ticket', id: ID }
			}
		]);
	});

	it('lets one that may have left the device but is not there go without a word', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		expect(only(h)).toMatchObject({ unanswered: true });
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(records(h)).toEqual([]);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
	});

	it('names one discarded while it is sent that arrives with that very request', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		const original = h.sendCreate.getMockImplementation();
		h.sendCreate.mockImplementationOnce(async (action, fields, signal) => {
			await h.outbox.discard(action.op);
			return (original as NonNullable<typeof original>)(action, fields, signal);
		});
		await goOnline(h);
		await settle();
		expect(records(h)).toEqual([ID]);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.id)).toEqual([`created-${OP}`]);
	});

	it('takes the changes of the ticket along, which never left the device', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.createdTicket(ID) ?? created.value, { status: 'done' });
		expect(h.outbox.count).toBe(2);
		await h.outbox.discard(OP);
		expect(h.outbox.actions.map((action) => action.op)).toEqual([OP]);
		await goOnline(h);
		expect(h.send).not.toHaveBeenCalled();
		expect(h.server.status.get(ID)).toBe('open');
	});

	it('"Rückgängig" after the lookup found it sends it once more under its identifier: still one ticket', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		const undo = h.flags.show.mock.calls.at(-1)?.[0]?.action?.run;
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		undo?.();
		await settle();
		await goOnline(h);
		expect(records(h)).toEqual([ID]);
		expect(h.server.counter).toBe(1);
		expect(h.outbox.count).toBe(0);
	});

	it('keeps a change of the ticket the server shows under the ID of a discarded creation, and sends it', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		expect(h.outbox.markOf(ID)).toBeNull();
		// The ticket of the server reaches the list by realtime; the user completes it.
		const served = await h.get(ID);
		const shown = await h.outbox.changeStatus(served, { status: 'done' });
		expect(shown.status).toBe('done');
		expect(h.outbox.actions.map((action) => [action.kind, action.dependsOn])).toEqual([
			['ticket.create', []],
			['ticket.update', []]
		]);
		await goOnline(h);
		expect(h.server.status.get(ID)).toBe('done');
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.id)).toEqual([`created-${OP}`]);
	});
});

describe('"＋" into the inbox (OF-4a)', () => {
	it('is kept without a connection, shown in the inbox, and arrives under the same ID', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createItem({ ...ITEM_DRAFT, project: PROJECT });
		expect(created.kept).toBe(true);
		expect(created.value).toMatchObject({ id: ID, channel: 'quick', state: 'new' });
		expect(created.value.sourceMeta).toEqual({ preset: { project: PROJECT } });
		expect(h.outbox.createdItems().map((item) => item.id)).toEqual([ID]);
		expect(h.outbox.markOf(ID)).toBe('pending');
		await goOnline(h);
		expect(h.sendItem).toHaveBeenCalledTimes(1);
		expect(h.server.records.get(ID)).toMatchObject({ collection: 'inbox_items', key: '' });
		expect(h.server.counter).toBe(0);
		expect(h.sink.upsertItem).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
		expect(h.outbox.createdItems()).toEqual([]);
	});

	it('looks a discarded entry that may have arrived up in the inbox and names it', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createItem(ITEM_DRAFT);
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.getItem).toHaveBeenCalledWith(ID, expect.anything());
		expect(h.outbox.notices).toEqual([
			expect.objectContaining({
				text: 'Der verworfene Eintrag „Milch kaufen“ liegt schon im Eingang. Bitte dort prüfen und bei Bedarf verwerfen.',
				link: { record: 'inbox', id: ID }
			})
		]);
	});
});

describe('the time of a creation (OF-4a)', () => {
	it('names a creation the deletion after 7 days took by its title (C2, C3)', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		vi.setSystemTime(NOW + KEEP_MS + 60_000);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(records(h)).toEqual([]);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: Neues Ticket „Zahnarzt anrufen“. Bitte im Ticket prüfen.'
		]);
	});

	it('never lets a discarded creation that may have arrived expire: it is looked up after 48 hours as well', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		vi.setSystemTime(NOW + 49 * 60 * 60 * 1000);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.id)).toEqual([`created-${OP}`]);
		expect(h.outbox.actions.some(isCreateAction)).toBe(false);
	});

	it('asks after 48 hours like every change and sends it without the time of the device', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		vi.setSystemTime(NOW + 49 * 60 * 60 * 1000);
		await goOnline(h);
		expect(only(h).state).toBe('expired');
		expect(h.sendCreate).not.toHaveBeenCalled();
		await h.outbox.sendAnyway(OP);
		await goOnline(h);
		expect(h.sendCreate.mock.calls.at(-1)?.[1]).toEqual({ opId: OP, offline: true });
		expect(records(h)).toEqual([ID]);
	});

	it('answers a repetition of a creation the account no longer sees as arrived, without a word', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		h.server.hidden.add(ID);
		await goOffline(h);
		await goOnline(h);
		expect(h.sendCreate).toHaveBeenCalledTimes(2);
		await expect(h.sendCreate.mock.results[1]?.value).rejects.toMatchObject({
			fields: { op_id: { code: 'validation_op_applied' } }
		});
		expect(h.outbox.count).toBe(0);
		expect(h.server.counter).toBe(1);
		expect(h.outbox.notices).toEqual([]);
	});
});
