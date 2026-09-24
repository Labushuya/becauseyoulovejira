// Search of the web app against the disposable instance (E3 plan, T-15 and package 11; ADR-0013
// section 2): hits in title, description and key, only own tickets, open tickets as IDs, done
// tickets through the filter of the section "Erledigt", and the finding on "%", "_", "\" and
// umlauts for the operator `~` of PocketBase 0.40.4.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { likeText } from '../../web/src/lib/data/like.ts';
import { listDoneTickets, searchOpenTicketIds } from '../../web/src/lib/data/tickets.ts';
import { EMPTY_LIST_QUERY } from '../../web/src/lib/domain/list-query.ts';

const BS = '\\';

describe('web search', () => {
	let a;
	let b;
	/** Tickets of A by title. */
	const ids = {};

	beforeAll(async () => {
		const superuser = await superuserClient();
		[a, b] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
		const project = await a.project(uniqueCode());
		const tickets = [
			{ title: 'Miete zahlen' },
			{ title: 'Hausgeld', description: 'Nebenkosten für die MIETWOHNUNG prüfen' },
			{ title: 'Im Projekt', project: project.id },
			{ title: '50% Rabatt' },
			{ title: '500 Euro' },
			{ title: 'a_b' },
			{ title: 'axb' },
			{ title: `back${BS}slash` },
			{ title: 'Äpfel kaufen' },
			{ title: 'äpfel waschen' },
			{ title: 'Miete April', status: 'done', priority: 'high' },
			{ title: 'Miete März', status: 'done', priority: 'low' }
		];
		for (const ticket of tickets) {
			const record = await a.ticket(ticket);
			ids[ticket.title] = record;
		}
		await b.ticket({ title: 'Miete von B' });
	});

	async function openTitles(search) {
		const found = await searchOpenTicketIds(a.client, search);
		return Object.values(ids)
			.filter((record) => found.includes(record.id))
			.map((record) => record.title)
			.sort();
	}

	it('finds open tickets by title, ignoring ASCII case, and never foreign or done ones', async () => {
		expect(await openTitles('miete')).toEqual(['Miete zahlen']);
		expect(await openTitles('MIETE ZAHLEN')).toEqual(['Miete zahlen']);
		expect(await searchOpenTicketIds(b.client, 'Miete')).toHaveLength(1);
	});

	it('finds a hit only in the description and one in the key', async () => {
		expect(await openTitles('nebenkosten')).toEqual(['Hausgeld']);
		expect(await openTitles('mietwohnung')).toEqual(['Hausgeld']);
		expect(await openTitles(ids['Im Projekt'].key)).toEqual(['Im Projekt']);
	});

	it('finding: without escaping, "%" is a wildcard and the value is not wrapped', async () => {
		const raw = async (value) =>
			(
				await a.client.collection('tickets').getFullList({
					filter: a.client.filter('title ~ {:q}', { q: value }),
					fields: 'title'
				})
			)
				.map((record) => record.title)
				.sort();

		// "50%" means "starts with 50", "%" means "anything".
		expect(await raw('50%')).toEqual(['50% Rabatt', '500 Euro']);
		expect((await raw('%')).length).toBeGreaterThan(2);
		// Without "%", "_" and "\" are taken literally.
		expect(await raw('a_b')).toEqual(['a_b']);
		expect(await raw(BS)).toEqual([`back${BS}slash`]);
		// A "\" before "%" or "_" escapes it.
		expect(await raw(`a${BS}_b`)).toEqual(['a_b']);
	});

	it('searches for exactly the typed text with "%", "_" and "\\" (likeText)', async () => {
		expect(await openTitles('50%')).toEqual(['50% Rabatt']);
		expect(await openTitles('%')).toEqual(['50% Rabatt']);
		expect(await openTitles('_')).toEqual(['a_b']);
		expect(await openTitles('a_b')).toEqual(['a_b']);
		expect(await openTitles(BS)).toEqual([`back${BS}slash`]);
		expect(await openTitles(`a${BS}_b`)).toEqual([]);
		expect(likeText('50%')).toBe(`50${BS}%`);
	});

	it('finding: umlauts are compared with case (SQLite LIKE folds ASCII only)', async () => {
		expect(await openTitles('äpfel')).toEqual(['äpfel waschen']);
		expect(await openTitles('Äpfel')).toEqual(['Äpfel kaufen']);
		expect(await openTitles('pfel')).toEqual(['Äpfel kaufen', 'äpfel waschen']);
	});

	it('narrows the done tickets with the search and the other filters', async () => {
		const titles = async (overrides) =>
			(
				await listDoneTickets(a.client, 1, {
					filter: { query: { ...EMPTY_LIST_QUERY, ...overrides }, today: '2026-09-25' }
				})
			).items
				.map((ticket) => ticket.title)
				.sort();

		expect(await titles({ search: 'miete' })).toEqual(['Miete April', 'Miete März']);
		expect(await titles({ search: 'miete', priority: 'high' })).toEqual(['Miete April']);
		expect(await titles({ search: 'zahlen' })).toEqual([]);
		// Shorter than two characters: no search.
		expect(await titles({ search: 'M' })).toEqual(['Miete April', 'Miete März']);
	});

	it('reports an aborted search as aborted', async () => {
		const controller = new AbortController();
		const request = searchOpenTicketIds(a.client, 'Miete', { signal: controller.signal });
		controller.abort();
		const error = await request.then(
			() => null,
			(failure) => failure
		);
		expect(error).toBeInstanceOf(DataError);
		expect(error.kind).toBe('aborted');
	});
});
