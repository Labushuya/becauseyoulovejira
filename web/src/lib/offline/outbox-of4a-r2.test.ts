// Round 2 of "＋" without a connection (OF-4a, ADR-0074 addendum OF-4a, section "Runde 2") on the
// scaffold of the outbox ($lib/test/outbox-fake.ts): a 5xx at the first attempt of a creation keeps it
// like a missing answer (A1); a lookup that does not find a discarded creation is final only 5 minutes
// after its last request, also after a refusal that followed a request without an answer (A5); a
// repetition the server answers with `validation_op_applied` names the creation (A7); the deletion
// after 7 days takes the changes of a creation along and names them (A8); the words per kind (A10);
// a lookup without a connection or with a 5xx leaves the creation waiting (A11).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { KEEP_MS, type KeptAction } from '$lib/domain/offline';
import type { TicketDraft } from '$lib/domain/ticket';
import {
	ALL_OPS,
	NOW,
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
const MINUTE = 60_000;
/** A lookup that does not find a discarded creation is final this long after its last request. */
const GRACE = 5 * MINUTE;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(): Promise<Harness> {
	const h = harness({ support: ALL_OPS });
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

function records(h: Harness): string[] {
	return [...h.server.records.keys()];
}

/** The way of the fake server for a creation, without the spy (a request the outbox did not make). */
function serverCreate(h: Harness) {
	const create = h.sendCreate.getMockImplementation();
	if (create === undefined) throw new Error('No way to create.');
	return create;
}

/** The next request of a creation does not reach the server: no answer, nothing written. */
function unreached(h: Harness): void {
	h.sendCreate.mockRejectedValueOnce(new DataError('network'));
}

describe('a 5xx at the first attempt of a creation (A1)', () => {
	it.each([500, 502, 503, 504])(
		'keeps a ticket after %i like a missing answer and creates it once later under the same identifier and ID',
		async (status) => {
			const h = await ready();
			const create = serverCreate(h);
			// The server took it, a proxy answered with a 5xx: it may have arrived.
			h.sendCreate.mockImplementationOnce(async (action, fields, signal) => {
				await create(action, fields, signal);
				throw new DataError('server', { status });
			});
			const created = await h.outbox.createTicket(draft());
			expect(created.kept).toBe(true);
			expect(created.value).toMatchObject({ id: ID, key: '', title: 'Zahnarzt anrufen' });
			expect(only(h)).toMatchObject({
				op: OP,
				target: ID,
				state: 'queued',
				unanswered: true,
				attempts: 1
			});
			expect(h.outbox.createdTicket(ID)).not.toBeNull();
			await vi.advanceTimersByTimeAsync(3_000);
			expect(h.sendCreate).toHaveBeenCalledTimes(2);
			expect(h.sendCreate.mock.calls.map((call) => [call[0].target, call[1].opId])).toEqual([
				[ID, OP],
				[ID, OP]
			]);
			expect(records(h)).toEqual([ID]);
			expect(h.server.counter).toBe(1);
			expect(h.outbox.count).toBe(0);
		}
	);

	it('keeps an entry of the inbox after a 5xx before the server took it, and puts it in once later', async () => {
		const h = await ready();
		h.sendItem.mockRejectedValueOnce(new DataError('server', { status: 502 }));
		const created = await h.outbox.createItem(ITEM_DRAFT);
		expect(created.kept).toBe(true);
		expect(only(h)).toMatchObject({ kind: 'inbox.create', unanswered: true, attempts: 1 });
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.sendItem).toHaveBeenCalledTimes(2);
		expect(h.sendItem.mock.calls[1]?.[1].opId).toBe(OP);
		expect(records(h)).toEqual([ID]);
		expect(h.outbox.count).toBe(0);
	});

	it('still refuses the first attempt like today when the server answers with 4xx', async () => {
		const h = await ready();
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await expect(h.outbox.createTicket(draft({ project: PROJECT }))).rejects.toBeInstanceOf(
			DataError
		);
		expect(h.outbox.count).toBe(0);
	});
});

describe('the lookup of a discarded creation, 5 minutes after its last request (A5)', () => {
	it('remembers when the last request of a creation left', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		vi.setSystemTime(NOW + MINUTE);
		unreached(h);
		await goOnline(h);
		expect(only(h)).toMatchObject({ unanswered: true, lastSentAt: NOW + MINUTE });
	});

	it('looks again after 5 minutes when the first lookup does not find it, and names a request that arrived late', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		const kept = only(h);
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.get).toHaveBeenCalledTimes(1);
		// Not found yet: the request without an answer may still be on its way.
		expect(only(h)).toMatchObject({ op: OP, discarded: true, state: 'queued' });
		expect(h.outbox.notices).toEqual([]);
		// It arrives now, after the lookup.
		await serverCreate(h)(kept as never, { opId: OP }, new AbortController().signal);
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.get).toHaveBeenCalledTimes(2);
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'Das verworfene Ticket „Zahnarzt anrufen“ wurde schon angelegt (TASK-1). Bitte im Ticket prüfen und bei Bedarf löschen.'
		]);
	});

	it('lets it go without a word when the second lookup after 5 minutes does not find it either', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		await goOnline(h);
		expect(h.outbox.count).toBe(1);
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.get).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(records(h)).toEqual([]);
	});

	it('takes a lookup as final at once when the last request is 5 minutes ago', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		vi.setSystemTime(NOW + GRACE + MINUTE);
		await goOnline(h);
		expect(h.get).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
	});

	it('looks a creation up that the server refused after a request without an answer, instead of deleting it', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft({ project: PROJECT }));
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		const kept = only(h);
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await goOnline(h);
		expect(only(h)).toMatchObject({ state: 'refused' });
		await goOffline(h);
		await h.outbox.discard(OP);
		// The first request may still arrive: it stays, discarded, only to be looked up.
		expect(only(h)).toMatchObject({ op: OP, discarded: true });
		expect(h.outbox.createdTickets()).toEqual([]);
		h.server.refuseCreate = null;
		await serverCreate(h)(kept as never, { opId: OP }, new AbortController().signal);
		await goOnline(h);
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.sendCreate).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.link)).toEqual([{ record: 'ticket', id: ID }]);
	});

	it('deletes a refused creation at once whose requests all got an answer', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft({ project: PROJECT }));
		h.server.refuseCreate = { field: 'project', code: 'validation_project_archived' };
		await goOnline(h);
		expect(only(h)).toMatchObject({ state: 'refused' });
		await h.outbox.discard(OP);
		expect(h.outbox.count).toBe(0);
	});
});

describe('a repetition the account no longer sees (A7)', () => {
	it('names a creation the server answers with "validation_op_applied" in a notice that stays, with a link', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		h.server.hidden.add(ID);
		await goOffline(h);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.server.counter).toBe(1);
		expect(h.outbox.notices).toEqual([
			{
				id: `created-${OP}`,
				text: 'Das neue Ticket „Zahnarzt anrufen“ wurde angelegt, ist aber nicht mehr sichtbar (Papierkorb?). Bitte im Papierkorb prüfen.',
				link: { record: 'ticket', id: ID }
			}
		]);
	});

	it('names an entry of the inbox the same way', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createItem(ITEM_DRAFT);
		h.server.lose = 1;
		await goOnline(h);
		h.server.hidden.add(ID);
		await goOffline(h);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'Der neue Eingangseintrag „Milch kaufen“ wurde angelegt, ist aber nicht mehr sichtbar. Bitte im Eingang prüfen.'
		]);
	});
});

describe('the deletion after 7 days of a creation with changes (A8)', () => {
	it('takes the changes that wait for the creation along and names them in its notice', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		unreached(h);
		await goOnline(h);
		await goOffline(h);
		// Six days later the user completes the new ticket: a change that waits for its creation.
		vi.setSystemTime(NOW + 6 * 24 * 60 * MINUTE);
		await h.outbox.changeStatus(h.outbox.createdTicket(ID) ?? created.value, { status: 'done' });
		expect(h.outbox.actions.map((action) => action.kind)).toEqual([
			'ticket.create',
			'ticket.update'
		]);
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.send).not.toHaveBeenCalled();
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: das neue Ticket „Zahnarzt anrufen“. Mit dem neuen Ticket „Zahnarzt anrufen“ wurde auch 1 Änderung daran gelöscht. Bitte im Ticket prüfen.'
		]);
	});
});

describe('the words of a creation per kind (A10)', () => {
	it('says "das neue Ticket" after "Verwerfen" of a ticket that may have arrived', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('Neues Ticket „Zahnarzt anrufen“ verworfen.');
		expect(flag?.description).toBe(
			'Vielleicht ist das neue Ticket schon angekommen. Es wird nicht noch einmal gesendet; sobald eine Verbindung besteht, sieht die App nach und meldet sich, falls es das Ticket schon gibt.'
		);
	});

	it('says "der neue Eingangseintrag" after "Verwerfen" of an entry that may have arrived', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createItem(ITEM_DRAFT);
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('Neuer Eingangseintrag „Milch kaufen“ verworfen.');
		expect(flag?.description).toBe(
			'Vielleicht ist der neue Eingangseintrag schon angekommen. Er wird nicht noch einmal gesendet; sobald eine Verbindung besteht, sieht die App nach und meldet sich, falls es ihn schon gibt.'
		);
	});

	it('names the ID of the new ticket that is taken', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.status.set(ID, 'open');
		await goOnline(h);
		expect(only(h).outcome?.message).toBe(
			'Die ID des neuen Tickets ist auf dem Server schon vergeben.'
		);
	});

	it('names a discarded creation the deletion after 7 days took in a sentence of its own', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: das neue Ticket „Zahnarzt anrufen“. Ob das neue Ticket „Zahnarzt anrufen“ trotz „Verwerfen“ schon angelegt wurde, ließ sich nicht mehr nachsehen. Bitte im Ticket prüfen.'
		]);
	});
});

describe('a lookup that gets no answer (A11)', () => {
	it('leaves a discarded creation waiting to be looked up without a connection: nothing is sent or deleted', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		// The check of the server answers, but no request gets through.
		h.server.health = true;
		h.server.reachable = false;
		await h.connectivity.check();
		await settle();
		expect(h.get).toHaveBeenCalledTimes(1);
		expect(only(h)).toMatchObject({ op: OP, discarded: true, state: 'queued' });
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(records(h)).toEqual([ID]);
		expect(h.outbox.notices).toEqual([]);
		await goOffline(h);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.id)).toEqual([`created-${OP}`]);
	});

	it('leaves it waiting after a 5xx of the lookup and looks again later', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createTicket(draft());
		h.server.lose = 1;
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(OP);
		h.get.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(only(h)).toMatchObject({ op: OP, discarded: true, state: 'queued' });
		expect(h.sendCreate).toHaveBeenCalledTimes(1);
		expect(h.outbox.notices).toEqual([]);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.get).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.id)).toEqual([`created-${OP}`]);
	});
});
