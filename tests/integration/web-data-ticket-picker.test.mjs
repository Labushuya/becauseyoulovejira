// Done tickets of the ticket picker (ADR-0042) against PocketBase: the loose patterns find titles
// with umlauts, ß and accents although SQLite LIKE folds only ASCII, the picker narrows them
// exactly, several words must all match, the project filter takes sub projects in or not and knows
// "Ohne Projekt", pages of PICKER_DONE_PAGE_SIZE, "%" stays literal, and neither open tickets nor
// tickets of another user or in the trash come back. The area of tickets and entries reaches the
// SPA for the rules of the picker.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { createItem } from '../../web/src/lib/data/inbox.ts';
import {
	PICKER_DONE_PAGE_SIZE,
	deleteTicket,
	listDoneTicketChoices,
	listOpenTickets
} from '../../web/src/lib/data/tickets.ts';
import { NO_PROJECT } from '../../web/src/lib/domain/list-query.ts';
import { loosePattern, matchesWords, searchWords } from '../../web/src/lib/domain/ticket-picker.ts';

let superuser;

beforeAll(async () => {
	superuser = await superuserClient();
});

/** The query of the picker for a typed text, without project. */
function query(text, project = null, withSubProjects = false) {
	return { patterns: searchWords(text).map(loosePattern), project, withSubProjects };
}

/** Titles the server returns for a text, and those the picker keeps after the exact check. */
async function found(client, text) {
	const { items } = await listDoneTicketChoices(client, query(text), 1);
	const kept = items.filter((ticket) => matchesWords(ticket, searchWords(text)));
	return { server: items.map((ticket) => ticket.title).sort(), kept: kept.map((ticket) => ticket.title).sort() };
}

describe('web data layer: done tickets of the ticket picker', () => {
	it('finds titles with umlauts, ß and accents whichever way they are typed', async () => {
		const owner = await createOwner(superuser);
		await owner.ticket({ title: 'Äpfel ernten', status: 'done' });
		await owner.ticket({ title: 'Hauptstraße fegen', status: 'done' });
		await owner.ticket({ title: 'Crème brûlée backen', status: 'done' });
		await owner.ticket({ title: 'Äpfel an der Straße verkaufen', status: 'done' });
		await owner.ticket({ title: 'Birnen ernten', status: 'done' });
		await owner.ticket({ title: 'Äpfel noch offen' });

		for (const text of ['äpfel', 'Äpfel', 'apfel', 'APFEL']) {
			expect((await found(owner.client, text)).kept, text).toEqual([
				'Äpfel an der Straße verkaufen',
				'Äpfel ernten'
			]);
		}
		for (const text of ['strasse', 'Straße', 'STRASSE']) {
			expect((await found(owner.client, text)).kept, text).toEqual([
				'Hauptstraße fegen',
				'Äpfel an der Straße verkaufen'
			]);
		}
		expect((await found(owner.client, 'creme brulee')).kept).toEqual(['Crème brûlée backen']);
		// Several words: all of them, in any order.
		expect((await found(owner.client, 'strasse apfel')).kept).toEqual([
			'Äpfel an der Straße verkaufen'
		]);
		// The server may return more (a superset); the open ticket never.
		const loose = await found(owner.client, 'apfel');
		expect(loose.server).toEqual(expect.arrayContaining(loose.kept));
		expect(loose.server).not.toContain('Äpfel noch offen');
	});

	it('takes "%" and "_" literally and finds keys', async () => {
		const owner = await createOwner(superuser);
		const sale = await owner.ticket({ title: '50% Rabatt', status: 'done' });
		await owner.ticket({ title: '500 Euro', status: 'done' });
		await owner.ticket({ title: 'a_b', status: 'done' });
		await owner.ticket({ title: 'axb', status: 'done' });
		expect((await found(owner.client, '50%')).server).toEqual(['50% Rabatt']);
		expect((await found(owner.client, 'a_b')).kept).toEqual(['a_b']);
		const byKey = await listDoneTicketChoices(owner.client, query(sale.key.toLowerCase()), 1);
		expect(byKey.items.map((ticket) => ticket.id)).toContain(sale.id);
	});

	it('narrows by project with or without its sub projects and by "Ohne Projekt"', async () => {
		const owner = await createOwner(superuser);
		const house = await owner.project(uniqueCode());
		const garden = await owner.project(uniqueCode(), { parent: house.id });
		const inHouse = await owner.ticket({ title: 'Dach', project: house.id, status: 'done' });
		const inGarden = await owner.ticket({ title: 'Beet', project: garden.id, status: 'done' });
		const without = await owner.ticket({ title: 'Ohne', status: 'done' });
		const ids = async (project, withSubProjects) =>
			(await listDoneTicketChoices(owner.client, query('', project, withSubProjects), 1)).items
				.map((ticket) => ticket.id)
				.sort();

		expect(await ids(house.id, true)).toEqual([inHouse.id, inGarden.id].sort());
		expect(await ids(house.id, false)).toEqual([inHouse.id]);
		expect(await ids(garden.id, false)).toEqual([inGarden.id]);
		expect(await ids(NO_PROJECT, false)).toEqual([without.id]);
		expect(await ids(null, false)).toEqual([inHouse.id, inGarden.id, without.id].sort());
	});

	it('pages the most recently changed first', async () => {
		const owner = await createOwner(superuser);
		for (let index = 0; index <= PICKER_DONE_PAGE_SIZE; index += 1) {
			await owner.ticket({ title: `Seite ${index}`, status: 'done' });
		}
		const first = await listDoneTicketChoices(owner.client, query('seite'), 1);
		expect(first.items).toHaveLength(PICKER_DONE_PAGE_SIZE);
		expect(first.hasMore).toBe(true);
		const updated = first.items.map((ticket) => ticket.updated);
		expect(updated).toEqual([...updated].sort().reverse());
		const second = await listDoneTicketChoices(owner.client, query('seite'), 2);
		expect(second.items).toHaveLength(1);
		expect(second.hasMore).toBe(false);
	});

	it('never returns tickets of another user or in the trash', async () => {
		const owner = await createOwner(superuser);
		const other = await createOwner(superuser);
		const kept = await owner.ticket({ title: 'Papierkorb bleibt', status: 'done' });
		const trashed = await owner.ticket({ title: 'Papierkorb weg', status: 'done' });
		await deleteTicket(owner.client, trashed.id, { sources: 'inbox' });
		await other.ticket({ title: 'Papierkorb fremd', status: 'done' });
		const { items } = await listDoneTicketChoices(owner.client, query('papierkorb'), 1);
		expect(items.map((ticket) => ticket.id)).toEqual([kept.id]);
	});

	it('brings the area of tickets and inbox entries into the SPA', async () => {
		const owner = await createOwner(superuser);
		await owner.ticket({ title: 'Bereich' });
		const [open] = await listOpenTickets(owner.client);
		expect(open?.scope).toBe(`u:${owner.id}`);
		const outcome = await createItem(owner.client, {
			channel: 'manual',
			kind: 'todo',
			title: 'Eintrag mit Bereich'
		});
		expect(outcome.kind === 'created' ? outcome.item.scope : null).toBe(`u:${owner.id}`);
	});
});
