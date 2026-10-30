// "Papierkorb" in the phone frame (MO-7b, ADR-0073 addendum MO-7b) in jsdom with the real store on fake
// data and a controlled matchMedia: cards instead of the table (the title, a muted line with key,
// status, project, date, person and days, "Wiederherstellen" and "•••"), a tap on a card opens the
// preview; the row of the view holds "Filter" (only with blocked tickets) and the menu of the list
// ("Auswählen", "Papierkorb leeren …"); the filter sheet holds "Nur blockierte" without the order of
// the tickets; "Auswählen" with "Alle" and the bar of the selection at the bottom with its actions
// behind "Aktionen"; the preview as a page with the arrow back. The counter-checks: on a PC with the
// switch on and on a phone with the switch off the table stays as before.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { ProjectRef } from '$lib/domain/ticket';
import type { TrashItem, TrashPreview } from '$lib/domain/trash';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
import { TrashStore, type TrashData } from '$lib/stores/trash.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TrashPanel from './TrashPanel.svelte';
import TrashView from './TrashView.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/papierkorb') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SELF = 'user00000000001';
const A = 'ticket00000000a';
const B = 'ticket00000000b';
const PROJECTS: ProjectRef[] = [];

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
	return {
		id,
		key: id === A ? 'HAUS-1' : 'TASK-2',
		title: id === A ? 'Dach reparieren' : 'Keller',
		status: 'open',
		priority: 'medium',
		due: '',
		project: id === A ? { id: 'p1', code: 'HAUS', name: 'Haus', exists: true } : null,
		recurring: false,
		children: id === A ? 2 : 0,
		dependencies: 0,
		deletedAt: '2026-09-28 10:00:00.000Z',
		deletedBy: SELF,
		updated: '2026-09-28 10:00:00.000Z',
		daysLeft: id === A ? 30 : 1,
		...overrides
	};
}

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

async function showView(items = [item(A), item(B)]) {
	const data: TrashData = {
		list: vi.fn(async () => ({ items, retention: '30' as const })),
		preview: vi.fn(),
		restore: vi.fn(async (id: string) => ({
			id,
			key: 'HAUS-1',
			updated: '',
			tickets: [],
			newKeys: [],
			parentDetached: false,
			ruleMissing: [],
			seriesDetached: [],
			sourcesSkipped: []
		})),
		resolve: vi.fn(),
		purge: vi.fn(async () => undefined),
		purgeAll: vi.fn(async () => ({ purged: items.length, blocked: [] })),
		saveRetention: vi.fn(async (value) => value)
	};
	const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() }, SILENT_FLAGS);
	await store.reload();
	const view = render(TrashView, { props: { store, projects: PROJECTS, selfId: SELF } });
	await tick();
	return { store, data, view };
}

/** The card of a ticket by its key. */
const card = (key: string) =>
	[...document.querySelectorAll<HTMLElement>('li[data-trash-row]')].find((entry) =>
		entry.querySelector('.card-meta')?.textContent?.includes(key)
	) as HTMLElement;

/** The entries of the open menu of `trigger`. */
function menuOf(trigger: HTMLElement): HTMLElement {
	return document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement;
}

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/papierkorb');
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('"Papierkorb" as cards in the phone frame (MO-7b)', () => {
	it('shows cards instead of the table: the title, a muted line, "Wiederherstellen" and "•••"', async () => {
		useWindow(true, true);
		await showView();

		expect(screen.queryByRole('table')).toBeNull();
		const cards = [...document.querySelectorAll<HTMLElement>('li[data-trash-row]')];
		expect(cards.map((entry) => entry.querySelector('.card-title')?.textContent?.trim())).toEqual([
			'Dach reparieren',
			'Keller'
		]);
		const roof = card('HAUS-1');
		const title = within(roof).getByRole('link', { name: 'Dach reparieren' });
		expect(title.getAttribute('href')).toBe(`/papierkorb/${A}`);
		expect(title.hasAttribute('data-row-link')).toBe(true);
		const meta = (roof.querySelector('.card-meta') as HTMLElement).textContent?.replace(
			/\s+/g,
			' '
		);
		for (const part of [
			'HAUS-1',
			'Offen',
			'Haus (HAUS)',
			'Gelöscht 28.09.2026 12:00',
			'von Du',
			'in 30 Tagen',
			'mit 2 Unteraufgaben'
		]) {
			expect(meta).toContain(part);
		}
		const restore = within(roof).getByRole('button', { name: 'Wiederherstellen: HAUS-1' });
		expect(restore.classList.contains('button-secondary')).toBe(true);
		const more = within(roof).getByRole('button', { name: 'Weitere Aktionen für HAUS-1' });
		expect(roof.hasAttribute('data-menu-row')).toBe(true);
		expect(
			within(menuOf(more))
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Vorschau öffnen', 'Wiederherstellen', 'Endgültig löschen …', 'Schließen']);
	});

	it('opens the preview with a tap on the card; "Wiederherstellen" keeps its own tap', async () => {
		useWindow(true, true);
		const { data } = await showView();

		await fireEvent.click(card('TASK-2').querySelector('.card-meta') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledWith(`/papierkorb/${B}`);

		mocks.goto.mockClear();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen: HAUS-1' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith(A, {}));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the row of the view: "Filter" only with blocked tickets and the menu of the list', async () => {
		useWindow(true, true);
		const { view } = await showView();
		const row = view.container.querySelector('.phone-tools') as HTMLElement;
		expect(within(row).queryByRole('button', { name: /^Filter/ })).toBeNull();
		const menu = menuOf(within(row).getByRole('button', { name: 'Weitere Aktionen der Liste' }));
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Auswählen', 'Papierkorb leeren …', 'Schließen']);
		// The switch, "Papierkorb leeren …" and "Spalten" of the PC are not above the list.
		expect(screen.queryByRole('button', { name: 'Papierkorb leeren …' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /auswählen$/ })).toBeNull();
		expect(
			screen
				.getByRole('heading', { level: 2, name: 'Papierkorb' })
				.classList.contains('visually-hidden')
		).toBe(true);

		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Papierkorb leeren …', hidden: true })
		);
		await tick();
		expect(screen.getByRole('dialog', { name: 'Papierkorb leeren?' })).toBeTruthy();
	});

	it('filters the blocked tickets in the sheet, without the order of the tickets', async () => {
		useWindow(true, true);
		await showView([item(A, { dependencies: 3 }), item(B)]);
		const button = screen.getByRole('button', { name: 'Filter' });
		await fireEvent.click(button);
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		expect(within(sheet).queryByRole('group', { name: 'Sortieren nach' })).toBeNull();
		expect(
			within(sheet).getByRole('button', { name: 'Zurücksetzen' }).getAttribute('aria-disabled')
		).toBe('true');
		await fireEvent.click(within(sheet).getByRole('switch', { name: 'Nur blockierte (1)' }));
		await tick();
		expect(document.querySelectorAll('li[data-trash-row]')).toHaveLength(1);
		expect(within(sheet).getByRole('button', { name: '1 Ticket anzeigen' })).toBeTruthy();
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Zurücksetzen' }));
		await tick();
		expect(document.querySelectorAll('li[data-trash-row]')).toHaveLength(2);
		await fireEvent.click(within(sheet).getByRole('button', { name: '2 Tickets anzeigen' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
	});

	it('chooses with "Auswählen": boxes on the cards, a tap chooses, "Alle" and the bar at the bottom', async () => {
		useWindow(true, true);
		const { data, view } = await showView();
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen der Liste' });
		await fireEvent.click(
			within(menuOf(trigger)).getByRole('menuitem', { name: 'Auswählen', hidden: true })
		);
		await tick();

		const box = (key: string) =>
			screen.getByRole<HTMLInputElement>('checkbox', { name: `${key} auswählen` });
		expect(box('HAUS-1').closest('label')?.classList.contains('check-target')).toBe(true);
		// The bar of the selection stands after the cards, flat, "Aktionen" locked while nothing is chosen.
		const bar = screen.getByRole('region', { name: '0 Tickets ausgewählt' });
		const list = view.container.querySelector('.trash-cards') as HTMLElement;
		expect(list.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(
			within(bar).getByRole('button', { name: 'Aktionen' }).getAttribute('aria-disabled')
		).toBe('true');

		// A tap on the card chooses it instead of opening the preview.
		await fireEvent.click(card('HAUS-1').querySelector('.card-meta') as HTMLElement);
		expect(box('HAUS-1').checked).toBe(true);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(card('HAUS-1').classList.contains('chosen')).toBe(true);

		const choosing = screen.getByRole('group', { name: 'Auswahl' });
		await fireEvent.click(
			within(choosing).getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' })
		);
		expect(screen.getByRole('region', { name: '2 Tickets ausgewählt' })).toBeTruthy();
		await fireEvent.click(box('HAUS-1'));
		const chosen = screen.getByRole('region', { name: '1 Ticket ausgewählt' });
		await fireEvent.click(within(chosen).getByRole('button', { name: 'Aktionen' }));
		await tick();
		const actions = within(chosen).getByRole('group', { name: 'Sammelaktionen' });
		expect(within(actions).getByRole('button', { name: 'Endgültig löschen …' })).toBeTruthy();
		await fireEvent.click(within(actions).getByRole('button', { name: 'Wiederherstellen' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledExactlyOnceWith(B, {}));

		// Once the action is done "Fertig" leaves "Auswählen".
		const done = await vi.waitFor(() =>
			within(screen.getByRole('region', { name: /ausgewählt$/ })).getByRole('button', {
				name: 'Fertig'
			})
		);
		await fireEvent.click(done);
		await tick();
		expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: /auswählen$/ })).toBeNull();
	});

	// MO-7b round 2 (P-1, P-4): after an action the actions are closed; "Fertig" leaves "Auswählen",
	// and the failures stay alone with "Ergebnis schließen", like the bar of the PC after ×, also
	// while and after "Papierkorb leeren …" fails.
	it('closes the actions after an action; after "Fertig" the failures stand alone, also after "Papierkorb leeren …" fails', async () => {
		useWindow(true, true);
		const { store, data } = await showView();
		const restoreOne = data.restore;
		data.restore = vi.fn<TrashData['restore']>(async (id, choices) => {
			if (id === B) throw new DataError('server', { status: 500 });
			return restoreOne(id, choices);
		});
		data.purgeAll = vi.fn<TrashData['purgeAll']>(async () => {
			throw new DataError('server', { status: 500 });
		});
		const listMenu = () =>
			menuOf(screen.getByRole('button', { name: 'Weitere Aktionen der Liste' }));
		await fireEvent.click(
			within(listMenu()).getByRole('menuitem', { name: 'Auswählen', hidden: true })
		);
		await tick();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' })
		);
		const bar = () => screen.getByRole('region', { name: /ausgewählt$/ });
		await fireEvent.click(within(bar()).getByRole('button', { name: 'Aktionen' }));
		await tick();
		await fireEvent.click(within(bar()).getByRole('button', { name: 'Wiederherstellen' }));
		await vi.waitFor(() =>
			expect(within(bar()).getByText('1 Ticket wurde nicht bearbeitet:')).toBeTruthy()
		);
		// TASK-2 failed and stays chosen; the actions closed with the end of the action.
		expect(within(bar()).getByText('1 Ticket ausgewählt')).toBeTruthy();
		expect(within(bar()).queryByRole('group', { name: 'Sammelaktionen' })).toBeNull();
		expect(
			within(bar()).getByRole('button', { name: 'Aktionen' }).getAttribute('aria-expanded')
		).toBe('false');

		await fireEvent.click(within(bar()).getByRole('button', { name: 'Fertig' }));
		await tick();
		expect(screen.queryByRole('group', { name: 'Auswahl' })).toBeNull();
		/** The bar after "Fertig": the number, the failures and "Ergebnis schließen", nothing else. */
		function expectResultAlone() {
			const left = screen.getByRole('region', { name: '0 Tickets ausgewählt' });
			expect(within(left).getByText('1 Ticket wurde nicht bearbeitet:')).toBeTruthy();
			expect(within(left).queryByRole('button', { name: 'Aktionen' })).toBeNull();
			expect(within(left).queryByRole('button', { name: 'Fertig' })).toBeNull();
			return left;
		}
		expectResultAlone();

		await fireEvent.click(
			within(listMenu()).getByRole('menuitem', { name: 'Papierkorb leeren …', hidden: true })
		);
		await tick();
		const question = screen.getByRole('dialog', { name: 'Papierkorb leeren?' });
		await fireEvent.click(within(question).getByRole('button', { name: 'Papierkorb leeren' }));
		await vi.waitFor(() => expect(data.purgeAll).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(store.progress).toBeNull());
		await tick();
		const left = expectResultAlone();

		await fireEvent.click(within(left).getByRole('button', { name: 'Ergebnis schließen' }));
		await tick();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
	});
});

// MO-7c1 (Q-1 and Q-2 of the review of MO-7b): "Wiederherstellen" of the chosen tickets gives the
// focus back like the bar of "Aufgaben" (BulkActionBar.run), and "Ergebnis schließen" as well: into
// the bar while it stands, otherwise to the heading "Papierkorb", never to the page (body).
describe('the focus after the bulk actions of the trash (MO-7c1)', () => {
	const heading = () => screen.getByRole('heading', { level: 2, name: 'Papierkorb' });

	it('keeps the focus in the bar after "Wiederherstellen" and puts it on the heading once the bar is gone (Q-1, Q-2)', async () => {
		useWindow(true, true);
		const { data } = await showView();
		const restoreOne = data.restore;
		data.restore = vi.fn<TrashData['restore']>(async (id, choices) => {
			if (id === B) throw new DataError('server', { status: 500 });
			return restoreOne(id, choices);
		});
		await fireEvent.click(
			within(menuOf(screen.getByRole('button', { name: 'Weitere Aktionen der Liste' }))).getByRole(
				'menuitem',
				{ name: 'Auswählen', hidden: true }
			)
		);
		await tick();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' })
		);
		const bar = () => screen.getByRole('region', { name: /ausgewählt$/ });
		await fireEvent.click(within(bar()).getByRole('button', { name: 'Aktionen' }));
		await tick();
		const restore = within(bar()).getByRole('button', { name: 'Wiederherstellen' });
		restore.focus();
		await fireEvent.click(restore);
		await vi.waitFor(() =>
			expect(within(bar()).getByText('1 Ticket wurde nicht bearbeitet:')).toBeTruthy()
		);
		// The actions closed with the end of the action and took "Wiederherstellen" with them; the focus
		// goes to the first button of the bar, like after the actions of "Aufgaben": the result stands
		// first, so "Ergebnis schließen".
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(bar()).getByRole('button', { name: 'Ergebnis schließen' })
			)
		);

		await fireEvent.click(within(bar()).getByRole('button', { name: 'Fertig' }));
		await tick();
		const left = screen.getByRole('region', { name: '0 Tickets ausgewählt' });
		await fireEvent.click(within(left).getByRole('button', { name: 'Ergebnis schließen' }));
		await tick();
		expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(heading()));
	});

	it('puts the focus on the heading on the PC once "Wiederherstellen" leaves nothing to show (Q-2)', async () => {
		useWindow(false, true);
		await showView();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-1 auswählen' }));
		const restore = within(screen.getByRole('region', { name: '1 Ticket ausgewählt' })).getByRole(
			'button',
			{ name: 'Wiederherstellen' }
		);
		restore.focus();
		await fireEvent.click(restore);
		await vi.waitFor(() =>
			expect(screen.queryByRole('region', { name: /ausgewählt$/ })).toBeNull()
		);
		await vi.waitFor(() => expect(document.activeElement).toBe(heading()));
	});
});

describe('the preview of the trash as a page (MO-7b)', () => {
	it('names the arrow after its way back and goes back through it', async () => {
		useWindow(true, true);
		const onback = vi.fn();
		const preview: TrashPreview = {
			...item(A),
			description: '',
			tags: [],
			subtasks: [],
			group: '',
			sources: { handling: 'inbox', count: 0 },
			dependencyList: []
		};
		render(TrashPanel, {
			props: {
				preview,
				selfId: SELF,
				projects: PROJECTS,
				need: null,
				onrestore: vi.fn(),
				onresolve: vi.fn(),
				ondetach: vi.fn(),
				onpurge: vi.fn(),
				ondismissneed: vi.fn(),
				onclose: vi.fn(),
				backLabel: 'Zum Papierkorb',
				onback
			}
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Zum Papierkorb' }));
		expect(onback).toHaveBeenCalledOnce();
	});
});

describe('"Papierkorb" outside the phone frame stays the table (MO-7b)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('keeps the table, the switch and the bar of the PC on %s', async (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		await showView();
		expect(screen.getByRole('table')).toBeTruthy();
		expect(document.querySelectorAll('li[data-trash-row]')).toHaveLength(0);
		expect(screen.getByRole('button', { name: 'Papierkorb leeren …' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Spalten' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Weitere Aktionen der Liste' })).toBeNull();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' })
		);
		const bar = screen.getByRole('region', { name: '2 Tickets ausgewählt' });
		expect(within(bar).getByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
		expect(within(bar).queryByRole('button', { name: 'Aktionen' })).toBeNull();
	});
});

describe('styles of the trash in the phone frame (MO-7b)', () => {
	it('gives the title up to three lines and lets long words wrap', () => {
		const source = readFileSync(join(import.meta.dirname, 'TrashTable.svelte'), 'utf8');
		const frame = source.slice(source.indexOf('@media (max-width: 39.99rem) {'));
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.card-title \{[^}]*overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 3;\s*line-clamp: 3;/
		);
	});
});
