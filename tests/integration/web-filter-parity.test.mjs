// Parity of the two forms of the list filter (E3 plan, package 10; ADR-0013 section 3): the
// server expression of listDoneTickets returns exactly the done tickets that matchesFilter lets
// pass, for a matrix of tickets (every priority, due dates yesterday, today, +7, +8 and none,
// with and without project and tags) and of filter combinations.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { listDoneTickets, listOpenTickets } from '../../web/src/lib/data/tickets.ts';
import { addDays } from '../../web/src/lib/domain/berlin-date.ts';
import { matchesFilter } from '../../web/src/lib/domain/filter.ts';
import { DUE_FILTERS, EMPTY_LIST_QUERY, NO_PROJECT } from '../../web/src/lib/domain/list-query.ts';
import { PRIORITIES, STATUSES } from '../../web/src/lib/domain/status.ts';

/** "Today" is a parameter of the expression, so any fixed Berlin date works. */
const TODAY = '2026-09-25';
const DUE_OFFSETS = [-1, 0, 7, 8, null];
/** Well-formed record ID that belongs to nobody. */
const UNKNOWN_ID = 'zzzzzzzzzzzzzzz';

function stored(offset) {
	return offset === null ? '' : `${addDays(TODAY, offset)} 00:00:00.000Z`;
}

describe('web filter parity: server expression and matchesFilter', () => {
	let owner;
	let projects;
	let tags;
	let tickets;

	beforeAll(async () => {
		const superuser = await superuserClient();
		owner = await createOwner(superuser);
		projects = await Promise.all([owner.project(uniqueCode()), owner.project(uniqueCode())]);
		tags = await Promise.all([owner.tag('Einkauf'), owner.tag('Anruf')]);
		const tagSets = [[], [tags[0].id], [tags[1].id], [tags[0].id, tags[1].id]];
		const projectIds = ['', projects[0].id, projects[1].id];

		const drafts = [];
		// Done tickets: every priority and due date, rotating project and tags.
		let index = 0;
		for (const priority of PRIORITIES) {
			for (const offset of DUE_OFFSETS) {
				for (const project of projectIds) {
					drafts.push({
						status: 'done',
						priority,
						due: stored(offset),
						project,
						tags: tagSets[index % tagSets.length]
					});
					index += 1;
				}
			}
		}
		// Tickets that are not done: the expression must never return them.
		for (const status of STATUSES.filter((value) => value !== 'done')) {
			for (const offset of DUE_OFFSETS) {
				drafts.push({ status, priority: 'urgent', due: stored(offset), project: '', tags: [] });
			}
		}
		for (const draft of drafts) await owner.ticket(draft);

		const open = await listOpenTickets(owner.client);
		const done = await listDoneTickets(owner.client, 1, { perPage: 500 });
		tickets = [...open, ...done.items];
		expect(tickets).toHaveLength(drafts.length);
	});

	async function serverIds(query) {
		const page = await listDoneTickets(owner.client, 1, {
			perPage: 500,
			filter: { query, today: TODAY }
		});
		expect(page.hasMore).toBe(false);
		return page.items.map((ticket) => ticket.id).sort();
	}

	function clientIds(query) {
		return tickets
			.filter((ticket) => ticket.status === 'done' && matchesFilter(ticket, query, TODAY))
			.map((ticket) => ticket.id)
			.sort();
	}

	async function expectParity(overrides) {
		const query = { ...EMPTY_LIST_QUERY, ...overrides };
		expect(await serverIds(query), JSON.stringify(overrides)).toEqual(clientIds(query));
	}

	it('returns every done ticket and nothing else without filters', async () => {
		const ids = await serverIds(EMPTY_LIST_QUERY);
		expect(ids).toHaveLength(PRIORITIES.length * DUE_OFFSETS.length * 3);
		expect(ids).toEqual(clientIds(EMPTY_LIST_QUERY));
	});

	it('agrees for every single filter value', async () => {
		const single = [
			...STATUSES.map((status) => ({ status })),
			...PRIORITIES.map((priority) => ({ priority })),
			...DUE_FILTERS.map((due) => ({ due })),
			{ project: NO_PROJECT },
			{ project: projects[0].id },
			{ project: UNKNOWN_ID },
			{ tag: tags[0].id },
			{ tag: tags[1].id },
			{ tag: UNKNOWN_ID }
		];
		for (const overrides of single) await expectParity(overrides);
	});

	it('never returns a done ticket as overdue', async () => {
		expect(await serverIds({ ...EMPTY_LIST_QUERY, due: 'overdue' })).toEqual([]);
	});

	it('agrees for combinations of due date, project, tag and priority', async () => {
		const projectValues = [null, NO_PROJECT, projects[0].id, projects[1].id];
		const tagValues = [null, tags[0].id, tags[1].id];
		let index = 0;
		for (const due of [null, ...DUE_FILTERS]) {
			for (const project of projectValues) {
				for (const tag of tagValues) {
					const priority = [null, ...PRIORITIES][index % (PRIORITIES.length + 1)];
					await expectParity({ due, project, tag, priority, status: 'done' });
					index += 1;
				}
			}
		}
	});

	it('ignores sort, grouping and the switch', async () => {
		await expectParity({
			sort: { key: 'title', reversed: true },
			grouping: 'status',
			showDone: true
		});
	});
});
