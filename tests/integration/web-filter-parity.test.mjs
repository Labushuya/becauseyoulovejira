// Parity of the two forms of the filter of the view "Erledigte" (ER-1, ADR-0066 §3, after ADR-0013
// section 3): the server expression of listCompletedTickets returns exactly the done tickets that
// matchesDoneQuery lets pass, for a matrix of tickets (with and without project, in a sub project,
// with tags and charms, texts in title and description) and of filter combinations. With a search
// the client side adds the reference rule of ADR-0013 section 2 (title, description or key contain
// the text, ASCII letters regardless of case), because the list does not load the description.
// Besides: the number on all pages, the check of one ticket for a realtime event with a search
// (completedTicketMatches) and the area of the client (ADR-0059): "Privat" and the household each
// see only their own done tickets. Since E7-5 (ADR-0068 §3) also "Zuständig" in the household: the
// filter of the done view on the server and in matchesDoneQuery, and the card "Mir zugewiesen" and the
// filter "Zuständig" of the open list against the same question to the server, for each member.
//
// Own disposable instance (ST-1): many writes in the setup and many lists per case; on an own
// instance it does not wait for the writes of other files.

import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import {
	createAreaScenario,
	createOwner,
	uniqueCode,
	uniqueSuffix
} from '../support/scenario.mjs';
import { setClientArea } from '../../web/src/lib/data/area.ts';
import { NOBODY } from '../../web/src/lib/domain/assignee.ts';
import { matchesCard } from '../../web/src/lib/domain/filter-cards.ts';
import { matchesFilter } from '../../web/src/lib/domain/filter.ts';
import { EMPTY_LIST_QUERY } from '../../web/src/lib/domain/list-query.ts';
import {
	completedTicketMatches,
	countCompletedTickets,
	listCompletedTickets,
	listOpenTickets
} from '../../web/src/lib/data/tickets.ts';
import {
	EMPTY_DONE_QUERY,
	activeDoneSearch,
	matchesDoneQuery
} from '../../web/src/lib/domain/done-view.ts';
import { NO_PROJECT } from '../../web/src/lib/domain/list-query.ts';
import { STATUSES } from '../../web/src/lib/domain/status.ts';

/** Well-formed record ID that belongs to nobody. */
const UNKNOWN_ID = 'zzzzzzzzzzzzzzz';
const CHARMS = ['', 'auto', 'geld'];

/** Texts of the done tickets in turn: hits in the title, only in the description, with "%". */
const TEXTS = [
	{ title: 'Miete zahlen' },
	{ title: 'Garten', description: 'Nebenkosten der MIETE' },
	{ title: 'Rabatt 50% nutzen' },
	{ title: 'Steuer 500 Euro' }
];
const SEARCHES = ['miete', 'NEBENKOSTEN', '50%', '500', 'TASK-1', '_', 'M'];

let instance;

beforeAll(async () => {
	instance = await startPocketBase();
	// The first app account becomes administrator (ADR-0056 §2); like on the shared instance
	// (global-setup.mjs), an account of its own takes that place, so the owners stay normal accounts.
	await createAppUser(await superuserClient());
});

afterAll(async () => {
	await instance?.stop();
});

async function superuserClient() {
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('_superusers').authWithPassword(instance.email, instance.password);
	return client;
}

const sorted = (ids) => [...ids].sort();

describe('web filter parity of the view "Erledigte": server expression and matchesDoneQuery', () => {
	let owner;
	let house;
	let garden;
	let cellar;
	let tags;
	let tickets;
	/** Title, description and key per ticket ID, for the reference search. */
	const texts = new Map();
	/** As the catalog of the app answers it. */
	let subProjectsOf;

	beforeAll(async () => {
		const superuser = await superuserClient();
		owner = await createOwner(superuser);
		house = await owner.project(uniqueCode(), { name: 'Haus' });
		garden = await owner.project(uniqueCode(), { name: 'Garten', parent: house.id });
		cellar = await owner.project(uniqueCode(), { name: 'Keller' });
		tags = await Promise.all([owner.tag('Einkauf'), owner.tag('Anruf')]);
		subProjectsOf = (id) => (id === house.id ? [garden.id] : []);
		const tagSets = [[], [tags[0].id], [tags[1].id], [tags[0].id, tags[1].id]];
		const projectIds = ['', house.id, garden.id, cellar.id];

		let index = 0;
		for (const project of projectIds) {
			for (const charm of CHARMS) {
				for (const tagSet of [tagSets[index % 4], tagSets[(index + 1) % 4]]) {
					const record = await owner.ticket({
						status: 'done',
						project,
						charm,
						tags: tagSet,
						...TEXTS[index % TEXTS.length]
					});
					texts.set(record.id, [record.title, record.description, record.key]);
					index += 1;
				}
			}
		}
		// Tickets that are not done: the expression must never return them.
		for (const status of STATUSES.filter((value) => value !== 'done')) {
			for (const project of projectIds) {
				await owner.ticket({ status, project, charm: 'auto', title: 'Miete offen' });
			}
		}
		const done = await listCompletedTickets(owner.client, 1, { perPage: 500 });
		tickets = [...(await listOpenTickets(owner.client)), ...done.items];
		expect(done.items).toHaveLength(projectIds.length * CHARMS.length * 2);
	});

	function filterOf(query) {
		// As the store decides it: only when the chosen project has sub projects.
		const family =
			query.project !== null &&
			query.project !== NO_PROJECT &&
			query.subProjects &&
			subProjectsOf(query.project).length > 0;
		return family ? { query, withSubProjects: true } : { query };
	}

	async function serverIds(query) {
		const page = await listCompletedTickets(owner.client, 1, { perPage: 500, filter: filterOf(query) });
		expect(page.hasMore).toBe(false);
		expect(page.total).toBe(page.items.length);
		return sorted(page.items.map((ticket) => ticket.id));
	}

	/** Reference search: title, description or key contain the text (ASCII case folded). */
	function matchesSearch(id, search) {
		if (search === null) return true;
		const needle = search.toLowerCase();
		return texts.get(id).some((text) => text.toLowerCase().includes(needle));
	}

	function clientIds(query) {
		return sorted(
			tickets
				.filter((ticket) => matchesDoneQuery(ticket, query, subProjectsOf))
				.filter((ticket) => matchesSearch(ticket.id, activeDoneSearch(query)))
				.map((ticket) => ticket.id)
		);
	}

	async function expectParity(overrides) {
		const query = { ...EMPTY_DONE_QUERY, ...overrides };
		expect(await serverIds(query), JSON.stringify(overrides)).toEqual(clientIds(query));
	}

	it('returns every done ticket and nothing else without filters', async () => {
		const ids = await serverIds(EMPTY_DONE_QUERY);
		expect(ids).toHaveLength(24);
		expect(ids).toEqual(clientIds(EMPTY_DONE_QUERY));
		expect(await countCompletedTickets(owner.client, { query: EMPTY_DONE_QUERY })).toBe(24);
	});

	it('agrees for every single filter value', async () => {
		const single = [
			{ project: NO_PROJECT },
			{ project: house.id },
			{ project: house.id, subProjects: false },
			{ project: garden.id },
			{ project: cellar.id },
			{ project: UNKNOWN_ID },
			{ tag: tags[0].id },
			{ tag: tags[1].id },
			{ tag: UNKNOWN_ID },
			{ charm: 'auto' },
			{ charm: 'geld' },
			{ charm: 'zug' }
		];
		for (const overrides of single) await expectParity(overrides);
		// "Haus" takes the done tickets of Haus and Garten: 2 × 3 charms × 2.
		expect(await serverIds({ ...EMPTY_DONE_QUERY, project: house.id })).toHaveLength(12);
	});

	it('agrees for combinations of project, tag and charm', async () => {
		for (const project of [null, NO_PROJECT, house.id, garden.id]) {
			for (const tag of [null, tags[0].id, tags[1].id]) {
				for (const charm of [null, 'auto']) {
					await expectParity({ project, tag, charm });
					if (project === house.id) await expectParity({ project, tag, charm, subProjects: false });
				}
			}
		}
	});

	it('agrees with a search alone and combined with the other filters', async () => {
		for (const search of SEARCHES) {
			await expectParity({ search });
			await expectParity({ search, tag: tags[0].id, charm: 'geld' });
			await expectParity({ search, project: NO_PROJECT });
			await expectParity({ search, project: house.id });
		}
		expect(await serverIds({ ...EMPTY_DONE_QUERY, search: 'nebenkosten' })).toHaveLength(6);
	});

	it('checks one ticket of a realtime event with the search like the list', async () => {
		const query = { ...EMPTY_DONE_QUERY, search: 'nebenkosten', project: house.id };
		const expected = new Set(clientIds(query));
		const filter = filterOf(query);
		for (const ticket of tickets.filter((entry) => entry.status === 'done').slice(0, 12)) {
			expect(await completedTicketMatches(owner.client, ticket.id, filter), ticket.title).toBe(
				expected.has(ticket.id)
			);
		}
		const open = tickets.find((ticket) => ticket.status !== 'done');
		expect(await completedTicketMatches(owner.client, open.id, { query: EMPTY_DONE_QUERY })).toBe(
			false
		);
	});
});

describe('the area of the client (ADR-0059): only the done tickets of "Privat" or of the household', () => {
	it('lists, counts and checks only the tickets of the area the client shows', async () => {
		const superuser = await superuserClient();
		const owner = await createOwner(superuser);
		const { household } = await owner.client.send('/api/byl/household', {
			method: 'POST',
			body: { name: `Haus ${uniqueSuffix()}` },
			requestKey: null
		});
		const privat = await owner.ticket({ status: 'done', title: 'Privat erledigt' });
		const shared = await owner.ticket({
			status: 'done',
			title: 'Im Haushalt erledigt',
			household: household.id
		});
		await owner.ticket({ title: 'Im Haushalt offen', household: household.id });
		const titles = async () =>
			(await listCompletedTickets(owner.client, 1)).items.map((ticket) => ticket.title);

		try {
			setClientArea(owner.client, `u:${owner.id}`);
			expect(await titles()).toEqual(['Privat erledigt']);
			expect(await countCompletedTickets(owner.client, { query: EMPTY_DONE_QUERY })).toBe(1);
			expect(
				await completedTicketMatches(owner.client, shared.id, { query: EMPTY_DONE_QUERY })
			).toBe(false);

			setClientArea(owner.client, `h:${household.id}`);
			expect(await titles()).toEqual(['Im Haushalt erledigt']);
			expect(
				await completedTicketMatches(owner.client, privat.id, { query: EMPTY_DONE_QUERY })
			).toBe(false);
			expect(
				await completedTicketMatches(owner.client, shared.id, { query: EMPTY_DONE_QUERY })
			).toBe(true);
		} finally {
			setClientArea(owner.client, null);
		}
	});
});

describe('"Zuständig" in the household (E7-5, ADR-0068 §3): server and SPA agree', () => {
	const TODAY = '2026-10-05';
	let scenario;
	let scope;
	/** Done and open tickets of the household, as the list of each member loads them. */
	let done;

	beforeAll(async () => {
		scenario = await createAreaScenario(instance);
		const { a, b, householdId } = scenario;
		scope = `h:${householdId}`;
		for (const assignee of ['', a.id, b.id]) {
			for (const status of ['done', 'done', 'open', 'in_progress']) {
				await (assignee === b.id ? b : a).ticket({
					household: householdId,
					status,
					assignee,
					title: `Müll ${status} ${assignee === '' ? 'niemand' : assignee}`
				});
			}
		}
		// A private ticket of A: never in the lists of the household.
		await a.ticket({ status: 'done', title: 'Privat erledigt' });
		setClientArea(a.client, scope);
		done = (await listCompletedTickets(a.client, 1, { perPage: 500 })).items;
		setClientArea(a.client, null);
		expect(done).toHaveLength(6);
	});

	it('filters the done view by a person or "Niemand" like matchesDoneQuery', async () => {
		const { a, b } = scenario;
		setClientArea(a.client, scope);
		try {
			for (const assignee of [null, NOBODY, a.id, b.id, UNKNOWN_ID]) {
				const query = { ...EMPTY_DONE_QUERY, assignee };
				const page = await listCompletedTickets(a.client, 1, { perPage: 500, filter: { query } });
				const expected = done.filter((ticket) => matchesDoneQuery(ticket, query, () => []));
				expect(sorted(page.items.map((ticket) => ticket.id)), String(assignee)).toEqual(
					sorted(expected.map((ticket) => ticket.id))
				);
				expect(await countCompletedTickets(a.client, { query })).toBe(expected.length);
			}
			const mine = await listCompletedTickets(a.client, 1, {
				perPage: 500,
				filter: { query: { ...EMPTY_DONE_QUERY, assignee: a.id } }
			});
			expect(mine.items).toHaveLength(2);
			expect(mine.items.every((ticket) => ticket.assignee === a.id)).toBe(true);
		} finally {
			setClientArea(a.client, null);
		}
	});

	it('shows each member under "Mir zugewiesen" and "Zuständig" what the server names', async () => {
		for (const member of [scenario.a, scenario.b]) {
			setClientArea(member.client, scope);
			try {
				const open = await listOpenTickets(member.client);
				expect(open).toHaveLength(6);
				const server = async (filter, params) =>
					sorted(
						(
							await member.client.collection('tickets').getFullList({
								filter: member.client.filter(
									`household = {:household} && status != "done" && ${filter}`,
									{ household: scenario.householdId, ...params }
								),
								fields: 'id'
							})
						).map((ticket) => ticket.id)
					);
				const client = (predicate) =>
					sorted(open.filter(predicate).map((ticket) => ticket.id));

				expect(client((ticket) => matchesCard(ticket, 'mine', TODAY, member.id))).toEqual(
					await server('assignee = {:self}', { self: member.id })
				);
				expect(
					client((ticket) =>
						matchesFilter(ticket, { ...EMPTY_LIST_QUERY, cards: ['mine'] }, TODAY, undefined, member.id)
					)
				).toHaveLength(2);
				for (const [value, filter, params] of [
					[NOBODY, 'assignee = ""', {}],
					[scenario.a.id, 'assignee = {:who}', { who: scenario.a.id }],
					[scenario.b.id, 'assignee = {:who}', { who: scenario.b.id }]
				]) {
					expect(
						client((ticket) =>
							matchesFilter(ticket, { ...EMPTY_LIST_QUERY, assignee: value }, TODAY)
						),
						value
					).toEqual(await server(filter, params));
				}
			} finally {
				setClientArea(member.client, null);
			}
		}
	});
});
