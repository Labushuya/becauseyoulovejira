// The area of the client in the data layer (E7-3, ADR-0059 §2): filters narrowed to the area, new
// records in it, subscriptions that follow a change, and the area of a record a link opens. Without
// an area every filter is exactly the one of before.

import PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import {
	areaFilter,
	areaOptions,
	clientArea,
	clientHousehold,
	followArea,
	onAreaChange,
	recordScope,
	setClientArea
} from './area';
import { createProject } from './projects';
import { createTag } from './tags';
import { createTicket } from './tickets';

const USER = 'user00000000001';
const HOUSE = 'house0000000001';

function client() {
	return new PocketBase('http://127.0.0.1:8090');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('records the app creates', () => {
	const STAMP = '2026-10-04 08:00:00.000Z';
	/** A client of the account whose create answers with what was sent, as a stored record. */
	function creating() {
		const pb = client();
		pb.authStore.save('token', { id: USER, collectionId: 'users', collectionName: 'users' });
		const bodies: Record<string, unknown>[] = [];
		const create = vi.fn(async (body: Record<string, unknown>) => {
			bodies.push(body);
			return {
				id: 'record000000001',
				key: 'TASK-1',
				status: 'open',
				priority: 'medium',
				due: '',
				project: '',
				tags: [],
				recurrence: '',
				completed_at: '',
				archived: false,
				parent: '',
				color: '',
				created: STAMP,
				updated: STAMP,
				...body
			};
		});
		vi.spyOn(pb, 'collection').mockReturnValue({ create } as unknown as ReturnType<
			PocketBase['collection']
		>);
		return { pb, bodies };
	}

	const draft = {
		title: 'Einkaufen',
		description: '',
		status: 'open' as const,
		priority: 'medium' as const,
		due: null,
		project: null,
		tags: []
	};

	it('land in the household of the area of the client', async () => {
		const { pb, bodies } = creating();
		setClientArea(pb, `h:${HOUSE}`);
		await createTicket(pb, draft);
		await createProject(pb, { name: 'Haus', code: 'HAUS' });
		await createTag(pb, 'garten');
		expect(bodies.map((body) => body.household)).toEqual([HOUSE, HOUSE, HOUSE]);
	});

	it('send no household in "Privat" and without an area, as before', async () => {
		const { pb, bodies } = creating();
		await createTicket(pb, draft);
		setClientArea(pb, `u:${USER}`);
		await createTicket(pb, draft);
		await createTag(pb, 'garten');
		expect(bodies.map((body) => 'household' in body)).toEqual([false, false, false]);
	});

	it('follow a record of a known area instead of the switch (a sub-task)', async () => {
		const { pb, bodies } = creating();
		setClientArea(pb, `u:${USER}`);
		await createTicket(pb, { ...draft, parent: 'parent000000001' }, { household: HOUSE });
		setClientArea(pb, `h:${HOUSE}`);
		await createTicket(pb, { ...draft, parent: 'parent000000002' }, { household: '' });
		expect(bodies.map((body) => body.household)).toEqual([HOUSE, undefined]);
	});
});

describe('filters of the area', () => {
	it('leave every filter as before without an area', () => {
		const pb = client();
		expect(clientArea(pb)).toBeNull();
		expect(clientHousehold(pb)).toBe('');
		expect(areaFilter(pb, 'status != {:done}', { done: 'done' })).toBe(
			pb.filter('status != {:done}', { done: 'done' })
		);
		expect(areaOptions(pb)).toEqual({});
	});

	it('narrow to the area of the client with a parameter of pb.filter()', () => {
		const pb = client();
		setClientArea(pb, `h:${HOUSE}`);
		expect(clientHousehold(pb)).toBe(HOUSE);
		expect(areaFilter(pb, 'status != {:done}', { done: 'done' })).toBe(
			`(status != "done") && scope = "h:${HOUSE}"`
		);
		expect(areaOptions(pb)).toEqual({ filter: `scope = "h:${HOUSE}"` });
		setClientArea(pb, `u:${USER}`);
		expect(clientHousehold(pb)).toBe('');
		expect(areaOptions(pb, 'state = {:state}', { state: 'new' })).toEqual({
			filter: `(state = "new") && scope = "u:${USER}"`
		});
		setClientArea(pb, null);
		expect(areaOptions(pb)).toEqual({});
	});

	it('refuse anything but the scope of an area', () => {
		expect(() => setClientArea(client(), 'scope = ""')).toThrow(RangeError);
		expect(() => setClientArea(client(), 'u:kurz')).toThrow(RangeError);
	});

	it('are kept per client', () => {
		const one = client();
		const two = client();
		setClientArea(one, `h:${HOUSE}`);
		expect(clientArea(two)).toBeNull();
	});
});

describe('changes of the area', () => {
	it('reach the listeners after the current task, once per change', async () => {
		const pb = client();
		const listener = vi.fn();
		const stop = onAreaChange(pb, listener);
		setClientArea(pb, `u:${USER}`);
		expect(listener).not.toHaveBeenCalled();
		await settle();
		expect(listener).toHaveBeenCalledOnce();
		setClientArea(pb, `u:${USER}`);
		await settle();
		expect(listener).toHaveBeenCalledOnce();
		stop();
		setClientArea(pb, `h:${HOUSE}`);
		await settle();
		expect(listener).toHaveBeenCalledOnce();
	});

	it('make a subscription again with the new filter and end the old one', async () => {
		const pb = client();
		setClientArea(pb, `u:${USER}`);
		const made: string[] = [];
		const ended: string[] = [];
		const subscribe = vi.fn(async () => {
			const filter = areaOptions(pb).filter ?? '';
			made.push(filter);
			return async () => void ended.push(filter);
		});
		const stop = await followArea(pb, subscribe);
		expect(made).toEqual([`scope = "u:${USER}"`]);

		setClientArea(pb, `h:${HOUSE}`);
		await vi.waitFor(() => expect(made).toHaveLength(2));
		expect(made[1]).toBe(`scope = "h:${HOUSE}"`);
		expect(ended).toEqual([`scope = "u:${USER}"`]);

		await stop();
		expect(ended).toEqual([`scope = "u:${USER}"`, `scope = "h:${HOUSE}"`]);
		setClientArea(pb, `u:${USER}`);
		await settle();
		expect(made).toHaveLength(2);
	});

	it('try a failed subscription again after a change, as `hold` does', async () => {
		vi.useFakeTimers();
		try {
			const pb = client();
			setClientArea(pb, `u:${USER}`);
			let fail = false;
			const subscribe = vi.fn(async () => {
				if (fail) throw new Error('offline');
				return async () => undefined;
			});
			const stop = await followArea(pb, subscribe);
			fail = true;
			setClientArea(pb, `h:${HOUSE}`);
			await vi.advanceTimersByTimeAsync(0);
			expect(subscribe).toHaveBeenCalledTimes(2);
			fail = false;
			await vi.advanceTimersByTimeAsync(1_000);
			expect(subscribe).toHaveBeenCalledTimes(3);
			await stop();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('area of a record a link opens', () => {
	function fake(answer: () => Promise<unknown>) {
		const getOne = vi.fn(answer);
		const send = vi.fn(answer);
		const pb = { collection: vi.fn(() => ({ getOne })), send } as unknown as PocketBase;
		return { pb, getOne, send };
	}

	it('reads only the scope, also for a ticket of the trash', async () => {
		const ticket = fake(async () => ({ id: 'x', scope: `h:${HOUSE}` }));
		expect(await recordScope(ticket.pb, 'ticket', 'ticket000000001')).toBe(`h:${HOUSE}`);
		expect(ticket.getOne).toHaveBeenCalledWith(
			'ticket000000001',
			expect.objectContaining({ fields: 'id,scope' })
		);

		const trashed = fake(async () => ({ id: 'x', scope: `u:${USER}` }));
		expect(await recordScope(trashed.pb, 'trash', 'ticket000000001')).toBe(`u:${USER}`);
		expect(trashed.send).toHaveBeenCalledWith('/api/byl/trash/ticket000000001', expect.anything());
	});

	it('answers null for a record the account does not see', async () => {
		const missing = fake(async () => {
			throw Object.assign(new Error('missing'), { status: 404, response: {} });
		});
		expect(await recordScope(missing.pb, 'project', 'project00000001')).toBeNull();
		const odd = fake(async () => ({ id: 'x', scope: 'irgendwas' }));
		expect(await recordScope(odd.pb, 'rule', 'rule00000000001')).toBeNull();
	});
});
