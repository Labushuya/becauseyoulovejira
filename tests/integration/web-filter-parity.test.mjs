// Parity of the two forms of the list filter (E3 plan, packages 10 and 11; ADR-0013 section 3):
// the server expression of listDoneTickets returns exactly the done tickets that matchesFilter
// lets pass, for a matrix of tickets (every priority, due dates yesterday, today, +7, +8 and
// none, with and without project and tags) and of filter combinations. With a search, the client
// side adds the reference rule of ADR-0013 section 2 (title, description or key contain the
// text, ASCII letters regardless of case), because the list does not load the description.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { listDoneTickets, listOpenTickets } from '../../web/src/lib/data/tickets.ts';
import { addDays } from '../../web/src/lib/domain/berlin-date.ts';
import { matchesFilter } from '../../web/src/lib/domain/filter.ts';
import {
	DUE_FILTERS,
	EMPTY_LIST_QUERY,
	NO_PROJECT,
	activeSearch
} from '../../web/src/lib/domain/list-query.ts';
import { PRIORITIES, STATUSES } from '../../web/src/lib/domain/status.ts';

/** "Today" is a parameter of the expression, so any fixed Berlin date works. */
const TODAY = '2026-09-25';
const DUE_OFFSETS = [-1, 0, 7, 8, null];
/** Well-formed record ID that belongs to nobody. */
const UNKNOWN_ID = 'zzzzzzzzzzzzzzz';

/** Texts of the done tickets in turn: hits in the title, only in the description, with "%". */
const TEXTS = [
	{ title: 'Miete zahlen' },
	{ title: 'Garten', description: 'Nebenkosten der MIETE' },
	{ title: 'Rabatt 50% nutzen' },
	{ title: 'Steuer 500 Euro' }
];
const SEARCHES = ['miete', 'NEBENKOSTEN', '50%', '500', 'TASK-1', '_', 'M'];

function stored(offset) {
	return offset === null ? '' : `${addDays(TODAY, offset)} 00:00:00.000Z`;
}

describe('web filter parity: server expression and matchesFilter', () => {
	let owner;
	let projects;
	let tags;
	let tickets;
	/** Title, description and key per ticket ID, for the reference search. */
	const texts = new Map();

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
						tags: tagSets[index % tagSets.length],
						...TEXTS[index % TEXTS.length]
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
		for (const draft of drafts) {
			const record = await owner.ticket(draft);
			texts.set(record.id, [record.title, record.description, record.key]);
		}

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

	/** Reference search: title, description or key contain the text (ASCII case folded). */
	function matchesSearch(id, search) {
		if (search === null) return true;
		const needle = search.toLowerCase();
		return texts.get(id).some((text) => text.toLowerCase().includes(needle));
	}

	function clientIds(query) {
		return tickets
			.filter((ticket) => ticket.status === 'done' && matchesFilter(ticket, query, TODAY))
			.filter((ticket) => matchesSearch(ticket.id, activeSearch(query)))
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

	it('agrees with a search alone and combined with the other filters (package 11)', async () => {
		for (const search of SEARCHES) {
			await expectParity({ search });
			await expectParity({ search, priority: 'urgent', tag: tags[0].id });
			await expectParity({ search, due: 'none', project: NO_PROJECT });
			await expectParity({ search, status: 'done', project: projects[0].id });
		}
		expect((await serverIds({ ...EMPTY_LIST_QUERY, search: 'nebenkosten' })).length).toBe(
			PRIORITIES.length * DUE_OFFSETS.length * 3 / TEXTS.length
		);
	});

	it('ignores sort, grouping and the switch', async () => {
		await expectParity({
			sort: { key: 'title', reversed: true },
			grouping: 'status',
			showDone: true
		});
	});
});
