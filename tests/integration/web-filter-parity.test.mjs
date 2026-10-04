// Parity of the two forms of the list filter (E3 plan, packages 10 and 11; ADR-0013 section 3):
// the server expression of listDoneTickets returns exactly the done tickets that matchesFilter
// lets pass, for a matrix of tickets (every priority, due dates yesterday, today, +7, +8 and
// none, with and without project and tags) and of filter combinations. With a search, the client
// side adds the reference rule of ADR-0013 section 2 (title, description or key contain the
// text, ASCII letters regardless of case), because the list does not load the description.
// Since E4 package 9 the matrix has done tickets of every source (converted from inbox entries of
// every channel, and direct ones with manual, quick and without source) for the chip "Quelle".
//
// Own disposable instance (ST-1): with about 150 writes in its setup and many lists per case this
// file is by far the heaviest of the shared instance. Under load its setup ran past the 30 s of a
// hook there (locally 3 of 3 runs with three runs of that group at once) and once in the Linux CI
// a case past its 15 s. On an own instance it no longer waits for the writes of other files, and
// its limits are those of the files with processes (tests/support/timing.mjs, scalable).

import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createOwner, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { createItem } from '../../web/src/lib/data/inbox.ts';
import { createTicket, listDoneTickets, listOpenTickets } from '../../web/src/lib/data/tickets.ts';
import { INBOX_CHANNELS } from '../../web/src/lib/domain/inbox.ts';
import { SOURCE_FAMILIES } from '../../web/src/lib/domain/source.ts';
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

/** Message IDs of the Telegram entries. */
let messageNumber = 0;

/** Inbox draft of a channel with the fields its duplicate key needs (ADR-0014 section 3). */
function channelDraft(channel) {
	const suffix = uniqueSuffix();
	const draft = { channel, kind: 'todo', title: `Aus ${channel} ${suffix}` };
	switch (channel) {
		case 'link':
			return { ...draft, kind: 'link', sourceUrl: `https://example.com/${suffix}` };
		case 'eml':
		case 'mail':
			return { ...draft, kind: 'mail', sourceRef: `<${suffix}@example.com>` };
		case 'ics':
		case 'calendar':
			return { ...draft, kind: 'event', sourceRef: `uid-${suffix}` };
		case 'telegram':
			return { ...draft, kind: 'message', sourceRef: `42:${(messageNumber += 1)}` };
		case 'whatsapp':
			return {
				...draft,
				kind: 'message',
				sourceDate: '2026-09-20 10:00:00.000Z',
				body: `Nachricht ${suffix}`,
				sourceMeta: { chat: 'Familie', sender: 'Ben' }
			};
		case 'notion':
			return { ...draft, sourceRef: `page-${suffix}` };
		// The own inbox (ADR-0038): the external_id of the caller.
		case 'api':
			return { ...draft, sourceRef: `skript-${suffix}` };
		case 'whatsapp-web':
			return { ...draft, kind: 'message', sourceRef: `wa:${suffix}` };
		// GitHub (ADR-0050): a pull request by its node ID.
		case 'github':
			return { ...draft, kind: 'pull_request', sourceRef: `PR_${suffix}` };
		// Folders (ADR-0051): a file by its path.
		case 'folder':
			return { ...draft, kind: 'file', sourceRef: `/srv/ordner/${suffix}.pdf` };
		default:
			return draft;
	}
}

function stored(offset) {
	return offset === null ? '' : `${addDays(TODAY, offset)} 00:00:00.000Z`;
}

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
		// Done tickets of every source: converted from an entry of each channel (two each, with
		// rotating priority), and direct ones with manual and quick.
		const priorities = ['low', 'high'];
		for (const channel of INBOX_CHANNELS) {
			for (const priority of priorities) {
				const outcome = await createItem(owner.client, channelDraft(channel));
				if (outcome.kind !== 'created') throw new Error(`no entry for ${channel}`);
				const ticket = await createTicket(
					owner.client,
					{ ...sourceTicket(), priority },
					{ origin: { sourceItem: outcome.item.id } }
				);
				texts.set(ticket.id, [ticket.title, ticket.description, ticket.key]);
				drafts.push(ticket);
			}
		}
		for (const source of ['manual', 'quick']) {
			const ticket = await createTicket(owner.client, sourceTicket(), { origin: { source } });
			texts.set(ticket.id, [ticket.title, ticket.description, ticket.key]);
			drafts.push(ticket);
		}

		const open = await listOpenTickets(owner.client);
		const done = await listDoneTickets(owner.client, 1, { perPage: 500 });
		tickets = [...open, ...done.items];
		expect(tickets).toHaveLength(drafts.length);
	});

	function sourceTicket() {
		return {
			title: `Quelle ${uniqueSuffix()}`,
			description: '',
			status: 'done',
			priority: 'medium',
			due: null,
			project: null,
			tags: []
		};
	}

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
		expect(ids).toHaveLength(
			PRIORITIES.length * DUE_OFFSETS.length * 3 + INBOX_CHANNELS.length * 2 + 2
		);
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

	it('agrees for every source family, alone and with other filters (E4 package 9)', async () => {
		const sources = new Set(tickets.map((ticket) => ticket.source));
		expect([...sources].sort()).toEqual([null, ...INBOX_CHANNELS].sort());
		for (const source of SOURCE_FAMILIES) {
			await expectParity({ source });
			await expectParity({ source, priority: 'high' });
			await expectParity({ source, due: 'none', project: NO_PROJECT });
			await expectParity({ source, search: 'Quelle' });
		}
		// "Manuell" includes the tickets from before E4 (no source) and, since the own inbox
		// (ADR-0038), the channel "api": four channels with two tickets each.
		const manual = await serverIds({ ...EMPTY_LIST_QUERY, source: 'manual' });
		expect(manual.length).toBe(PRIORITIES.length * DUE_OFFSETS.length * 3 + 4 * 2 + 2);
	});

	it('ignores sort, grouping and the switch', async () => {
		await expectParity({
			sort: { key: 'title', reversed: true },
			grouping: 'status',
			showDone: true
		});
	});
});

describe('web filter parity with recurring tickets (plan OR-2)', () => {
	let owner;
	let tickets;

	beforeAll(async () => {
		const superuser = await superuserClient();
		owner = await createOwner(superuser);
		const rules = owner.client.collection('recurrence_rules');
		const repeat = (ticket) =>
			rules.create({
				owner: owner.id,
				title: ticket.title,
				mode: 'calendar',
				freq: 'weekly',
				initial_status: 'open',
				ticket: ticket.id
			});
		const created = [];
		// Far in the future, so completing an instance creates no follow-up with the real clock.
		for (const [index, priority] of ['low', 'high', 'low', 'high', 'urgent', 'medium'].entries()) {
			created.push(
				await owner.ticket({
					priority,
					due: index % 3 === 2 ? '' : '2031-01-06 00:00:00.000Z',
					title: `Wiederholung ${index % 2 === 0 ? 'Miete' : 'Garten'} ${uniqueSuffix()}`
				})
			);
		}
		// Two instances of a series, one released from its series again, three single ones.
		await repeat(created[0]);
		await repeat(created[1]);
		await repeat(created[2]);
		await owner.client.collection('tickets').update(created[2].id, { recurrence: '' });
		for (const ticket of created) {
			await owner.client.collection('tickets').update(ticket.id, { status: 'done' });
		}
		await owner.ticket({ status: 'open', priority: 'low' });
		const done = await listDoneTickets(owner.client, 1, { perPage: 500 });
		tickets = [...(await listOpenTickets(owner.client)), ...done.items];
		expect(done.items.filter((ticket) => ticket.recurring)).toHaveLength(2);
	});

	async function serverIds(query) {
		const page = await listDoneTickets(owner.client, 1, { perPage: 500, filter: { query, today: TODAY } });
		return page.items.map((ticket) => ticket.id).sort();
	}

	function clientIds(query) {
		const search = activeSearch(query);
		return tickets
			.filter((ticket) => ticket.status === 'done' && matchesFilter(ticket, query, TODAY))
			.filter((ticket) => search === null || ticket.title.toLowerCase().includes(search.toLowerCase()))
			.map((ticket) => ticket.id)
			.sort();
	}

	it('agrees for "nur wiederkehrende" and "nur einmalige", alone and with other filters', async () => {
		const cases = [
			{},
			{ recurring: 'recurring' },
			{ recurring: 'once' },
			{ recurring: 'recurring', priority: 'high' },
			{ recurring: 'once', priority: 'low' },
			{ recurring: 'once', due: 'none' },
			{ recurring: 'recurring', due: 'none' },
			{ recurring: 'recurring', search: 'Miete' },
			{ recurring: 'once', project: NO_PROJECT, status: 'done' },
			{ recurring: 'recurring', grouping: 'recurrence', showDone: true }
		];
		for (const overrides of cases) {
			const query = { ...EMPTY_LIST_QUERY, ...overrides };
			expect(await serverIds(query), JSON.stringify(overrides)).toEqual(clientIds(query));
		}
		expect(await serverIds({ ...EMPTY_LIST_QUERY, recurring: 'recurring' })).toHaveLength(2);
		// The released ticket counts as single again.
		expect(await serverIds({ ...EMPTY_LIST_QUERY, recurring: 'once' })).toHaveLength(4);
	});
});

describe('web filter parity with sub projects (ADR-0034)', () => {
	let owner;
	/** Haus with Garten and the archived Dach, Keller without sub projects. */
	let house;
	let garden;
	let roof;
	let cellar;
	let tickets;
	/** As the catalog of the app answers it. */
	let subProjectsOf;

	beforeAll(async () => {
		const superuser = await superuserClient();
		owner = await createOwner(superuser);
		house = await owner.project(uniqueCode(), { name: 'Haus' });
		garden = await owner.project(uniqueCode(), { name: 'Garten', parent: house.id });
		roof = await owner.project(uniqueCode(), { name: 'Dach', parent: house.id });
		cellar = await owner.project(uniqueCode(), { name: 'Keller' });
		for (const project of ['', house.id, garden.id, roof.id, cellar.id]) {
			for (const priority of ['low', 'high']) {
				await owner.ticket({ status: 'done', priority, project });
			}
			await owner.ticket({ status: 'open', priority: 'low', project });
		}
		await owner.client.collection('projects').update(roof.id, { archived: true });
		const children = { [house.id]: [garden.id, roof.id] };
		subProjectsOf = (id) => children[id] ?? [];
		const done = await listDoneTickets(owner.client, 1, { perPage: 500 });
		tickets = [...(await listOpenTickets(owner.client)), ...done.items];
	});

	async function serverIds(query) {
		const page = await listDoneTickets(owner.client, 1, {
			perPage: 500,
			filter: {
				query,
				today: TODAY,
				// As the list store decides it: only when the chosen project has sub projects.
				withSubProjects:
					query.project !== null && query.project !== NO_PROJECT && subProjectsOf(query.project).length > 0
			}
		});
		return page.items.map((ticket) => ticket.id).sort();
	}

	function clientIds(query) {
		return tickets
			.filter((ticket) => ticket.status === 'done' && matchesFilter(ticket, query, TODAY, subProjectsOf))
			.map((ticket) => ticket.id)
			.sort();
	}

	it('agrees for a parent with and without its sub projects, a sub project and the rest', async () => {
		const cases = [
			{ project: house.id },
			{ project: house.id, subProjects: false },
			{ project: house.id, priority: 'high' },
			{ project: house.id, subProjects: false, priority: 'low' },
			{ project: garden.id },
			{ project: roof.id },
			{ project: cellar.id },
			{ project: NO_PROJECT },
			{ project: UNKNOWN_ID },
			{}
		];
		for (const overrides of cases) {
			const query = { ...EMPTY_LIST_QUERY, ...overrides };
			expect(await serverIds(query), JSON.stringify(overrides)).toEqual(clientIds(query));
		}
		// "Haus" takes the done tickets of Haus, Garten and the archived Dach: 3 × 2.
		expect(await serverIds({ ...EMPTY_LIST_QUERY, project: house.id })).toHaveLength(6);
		expect(await serverIds({ ...EMPTY_LIST_QUERY, project: house.id, subProjects: false })).toHaveLength(2);
	});
});
