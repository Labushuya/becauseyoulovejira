// Settings "Fehlerprotokoll" (FP-3, ADR-0077 addendum FP-3): the switch "Diese Sitzung (n) | Server"
// with this tab first, the list of this tab with "Alle kopieren" and "Liste leeren", the log of the
// server with the filters "Quelle" and "Bereich" (only the areas the account may choose, none with one
// choice, back to "Alle" when the chosen one goes), a new filter that starts the list anew, "Mehr
// laden" after the last entry (51 asked, 50 shown, told to screen readers, the focus on "Erneut
// versuchen" after a failure), filters and pages kept across "Diese Sitzung", no connection (the list
// of this tab stays usable), and the rules of the phone frame. The server answers through a stubbed
// fetch, as the record API of problem_events would; the household of the account is a fake of the
// area store, the context of the tab is set like an answer of the server.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientProblem } from '$lib/domain/problems';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ServerProblemList from '$lib/components/problems/ServerProblemList.svelte';
import listSource from '$lib/components/problems/ServerProblemList.svelte?raw';
import Page from './+page.svelte';
import pageSource from './+page.svelte?raw';

const mocks = vi.hoisted(() => ({
	// Whether the account is a member of a household (area store of the (app) layout).
	member: false
}));

vi.mock('$lib/stores/area.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findAreaStore: () => ({ visible: mocks.member })
}));

useOverlayStubs();

/** An entry of the record API, `index` minutes before 10:00 of the 5th of November. */
function item(index: number, overrides: Record<string, unknown> = {}) {
	const at = new Date(Date.UTC(2026, 10, 5, 10, 0, 0) - index * 60_000)
		.toISOString()
		.replace('T', ' ');
	return {
		id: `entry${String(index).padStart(10, '0')}`,
		source: 'job',
		area: 'system',
		code: 'trash_failed',
		message: 'Papierkorb: Lauf gescheitert',
		context: { job: 'trash' },
		count: 1,
		first_at: at,
		last_at: at,
		...overrides
	};
}

/**
 * The record API of problem_events: `pages` in order, the first page for every query without a
 * cursor, the next one for a query after the cursor. Returns the asked filters.
 */
function serve(...pages: unknown[][]) {
	const filters: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async (input) => {
			const filter = new URL(String(input)).searchParams.get('filter') ?? '';
			filters.push(filter);
			const after = !filter.includes('("" = "" || last_at');
			const items = (after ? pages[1] : pages[0]) ?? [];
			return Response.json({ page: 1, perPage: 50, totalItems: -1, totalPages: -1, items });
		})
	);
	return filters;
}

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function renderPage() {
	const result = render(Page);
	await tick();
	return result;
}

async function showServer() {
	await fireEvent.click(screen.getByRole('button', { name: 'Server' }));
	await screen.findByText(
		'Der Server behält einen Eintrag 30 Tage nach seinem letzten Auftreten, höchstens 5000.'
	);
}

/** The names of the segments of a filter, the pressed one marked with "*". */
function segments(name: string): string[] {
	return within(screen.getByRole('group', { name }))
		.getAllByRole('button')
		.map((button) => `${text(button)}${button.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
}

beforeEach(async () => {
	mocks.member = false;
	problemLog.clear();
	problemLog.closeDialog();
	document.body.innerHTML = '';
	await useContext(PC_CONTEXT);
});

afterEach(() => vi.unstubAllGlobals());

describe('page "Fehlerprotokoll" (FP-3)', () => {
	it('shows the errors of this tab first, with "Alle kopieren" and "Liste leeren"', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		problemLog.record(
			clientProblem({
				id: 'page-1',
				intent: 'Ticket speichern',
				at: Date.UTC(2026, 10, 5, 9, 0, 0),
				outcome: { result: 'network', status: null, code: null, message: null },
				request: null,
				app: null,
				exception: null
			})
		);
		await renderPage();

		const views = screen.getByRole('group', { name: 'Welche Fehler' });
		const session = within(views).getByRole('button', { name: 'Diese Sitzung (1)' });
		expect(session.getAttribute('aria-pressed')).toBe('true');
		expect(within(views).getByRole('button', { name: 'Server' }).getAttribute('aria-pressed')).toBe(
			'false'
		);
		const list = screen.getByRole('list', { name: 'Fehler dieser Sitzung' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Alle kopieren' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Liste leeren' }));
		expect(problemLog.count).toBe(0);
		expect(within(views).getByRole('button', { name: 'Diese Sitzung (0)' })).toBeTruthy();
		// The server is asked only for its list.
		expect(fetchMock).not.toHaveBeenCalled();
		expect(screen.getByRole('link', { name: 'Hilfe' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#fehlerprotokoll'
		);
	});

	it('filters the log of the server by source and area; every new filter starts the list anew', async () => {
		mocks.member = true;
		const filters = serve([item(1), item(2)]);
		await renderPage();
		await showServer();

		expect(segments('Quelle')).toEqual(['Alle*', 'Anfrage', 'Kanal', 'Aufgabe']);
		expect(segments('Bereich')).toEqual(['Alle*', 'Privat', 'Haushalt', 'App']);
		expect(filters).toEqual([
			'("" = "" || source = "") && ("" = "" || area = "") && ("" = "" || last_at < "" || (last_at = "" && id < ""))'
		]);

		await fireEvent.click(screen.getByRole('button', { name: 'Kanal' }));
		await waitFor(() => expect(filters).toHaveLength(2));
		expect(filters[1]).toContain('("channel" = "" || source = "channel")');
		expect(filters[1]).toContain('("" = "" || area = "")');
		expect(segments('Quelle')).toEqual(['Alle', 'Anfrage', 'Kanal*', 'Aufgabe']);

		await fireEvent.click(screen.getByRole('button', { name: 'Haushalt' }));
		await waitFor(() => expect(filters).toHaveLength(3));
		expect(filters[2]).toContain('("channel" = "" || source = "channel")');
		expect(filters[2]).toContain('("household" = "" || area = "household")');
		// The first page again, without a cursor.
		expect(filters[2]).toContain('("" = "" || last_at < ""');

		// The same choice again asks nothing.
		await fireEvent.click(screen.getByRole('button', { name: 'Haushalt' }));
		await tick();
		expect(filters).toHaveLength(3);
		const list = await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
	});

	it.each([
		['another account without a household', MEMBER_CONTEXT, false, null],
		['a member of a household', MEMBER_CONTEXT, true, ['Alle*', 'Privat', 'Haushalt']],
		['the administrator on another device', REMOTE_CONTEXT, false, ['Alle*', 'Privat', 'App']],
		['a tab whose context is not known yet', 'pending' as const, false, null]
	])('offers the areas %s may choose', async (_who, context, member, areas) => {
		await useContext(context);
		mocks.member = member;
		serve([item(1)]);
		await renderPage();
		await showServer();

		expect(segments('Quelle')).toEqual(['Alle*', 'Anfrage', 'Kanal', 'Aufgabe']);
		if (areas === null) expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		else expect(segments('Bereich')).toEqual(areas);
	});

	it('loads 50 more after the last entry with "Mehr laden", until the last page', async () => {
		// 51 asked, 50 shown: the 51st only says that there is more.
		const first = Array.from({ length: 51 }, (_, index) => item(index));
		const next = [item(49), item(50), item(51)];
		const filters = serve(first, next);
		await renderPage();
		await showServer();
		const list = screen.getByRole('list', { name: 'Fehlerprotokoll des Servers' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(50);
		const live = document.querySelector('.server-problems p[aria-live="polite"]');
		expect(live?.classList.contains('visually-hidden')).toBe(true);
		expect(live?.textContent).toBe('');

		await fireEvent.click(screen.getByRole('button', { name: 'Mehr laden' }));
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(52));
		const at = `"${first[49]?.last_at}"`;
		expect(filters[1]).toContain(
			`(${at} = "" || last_at < ${at} || (last_at = ${at} && id < "${first[49]?.id}"))`
		);
		// Not a full page: the last one, the button goes and the focus to the first new entry; screen
		// readers hear how many came (without the one shown already).
		expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
		await waitFor(() =>
			expect(document.activeElement).toBe(within(list).getAllByRole('listitem')[50])
		);
		expect(live?.textContent).toBe('2 weitere geladen.');
		expect(filters).toHaveLength(2);
	});

	it('offers no "Mehr laden" for exactly 50 entries: nothing to find behind it', async () => {
		const filters = serve(Array.from({ length: 50 }, (_, index) => item(index)));
		await renderPage();
		await showServer();
		const list = screen.getByRole('list', { name: 'Fehlerprotokoll des Servers' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(50);
		expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
		expect(filters).toHaveLength(1);
	});

	it('puts the focus on "Erneut versuchen" when "Mehr laden" fails; the list stays', async () => {
		const first = Array.from({ length: 51 }, (_, index) => item(index));
		let answer: 'network' | 'server' | 'ok' = 'network';
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async (input) => {
				const filter = new URL(String(input)).searchParams.get('filter') ?? '';
				const after = !filter.includes('("" = "" || last_at');
				if (after && answer === 'network') throw new TypeError('Failed to fetch');
				if (after && answer === 'server') {
					return Response.json(
						{ status: 500, message: 'Something went wrong.', data: {} },
						{ status: 500 }
					);
				}
				const items = after ? [item(51)] : first;
				return Response.json({ page: 1, perPage: 51, totalItems: -1, totalPages: -1, items });
			})
		);
		await renderPage();
		await showServer();
		const list = screen.getByRole('list', { name: 'Fehlerprotokoll des Servers' });

		await fireEvent.click(screen.getByRole('button', { name: 'Mehr laden' }));
		expect(
			await screen.findByText(
				'Ohne Verbindung zum Server lassen sich keine weiteren Einträge laden.'
			)
		).toBeTruthy();
		const offline = screen.getByRole('button', { name: 'Erneut versuchen' });
		await waitFor(() => expect(document.activeElement).toBe(offline));
		expect(within(list).getAllByRole('listitem')).toHaveLength(50);

		// Any other failure: the message with "Details", the focus again on its "Erneut versuchen".
		answer = 'server';
		await fireEvent.click(offline);
		expect(await screen.findByText('Weitere Einträge ließen sich nicht laden.')).toBeTruthy();
		const failed = screen.getByRole('button', { name: 'Erneut versuchen' });
		await waitFor(() => expect(document.activeElement).toBe(failed));
		expect(within(list).getAllByRole('listitem')).toHaveLength(50);

		answer = 'ok';
		await fireEvent.click(failed);
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(51));
		await waitFor(() =>
			expect(document.activeElement).toBe(within(list).getAllByRole('listitem')[50])
		);
	});

	it('keeps the filters and the loaded pages while it shows "Diese Sitzung" in between', async () => {
		const first = Array.from({ length: 51 }, (_, index) => item(index));
		const filters = serve(first, [item(50), item(51)]);
		await renderPage();
		await showServer();
		await fireEvent.click(screen.getByRole('button', { name: 'Aufgabe' }));
		await waitFor(() => expect(filters).toHaveLength(2));
		await fireEvent.click(await screen.findByRole('button', { name: 'Mehr laden' }));
		await waitFor(() =>
			expect(
				within(screen.getByRole('list', { name: 'Fehlerprotokoll des Servers' })).getAllByRole(
					'listitem'
				)
			).toHaveLength(52)
		);
		expect(filters).toHaveLength(3);

		await fireEvent.click(screen.getByRole('button', { name: /^Diese Sitzung/ }));
		expect(screen.queryByRole('list', { name: 'Fehlerprotokoll des Servers' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Server' }));
		const list = await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(52);
		expect(segments('Quelle')).toEqual(['Alle', 'Anfrage', 'Kanal', 'Aufgabe*']);
		// Nothing asked again.
		await tick();
		expect(filters).toHaveLength(3);
	});

	it('goes back to "Alle" when the chosen area is no longer offered, e.g. the household was left', async () => {
		const filters = serve([item(1)]);
		const { rerender } = render(ServerProblemList, {
			props: { browse: true, areas: ['private', 'household'] as const }
		});
		await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });
		await fireEvent.click(screen.getByRole('button', { name: 'Haushalt' }));
		await waitFor(() => expect(filters).toHaveLength(2));
		expect(filters[1]).toContain('("household" = "" || area = "household")');
		expect(await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
		expect(segments('Bereich')).toEqual(['Alle', 'Privat', 'Haushalt*']);

		await rerender({ browse: true, areas: ['private'] as const });
		await waitFor(() => expect(filters).toHaveLength(3));
		expect(filters[2]).toContain('("" = "" || area = "")');
		expect(filters[2]).toContain('("" = "" || last_at < ""');
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		expect(await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
	});

	it('says when no entry matches the filters, and when the server keeps none', async () => {
		serve([]);
		await renderPage();
		await showServer();
		expect(
			screen.getByText('Der Server hat keinen Fehler festgehalten, den du sehen darfst.')
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Anfrage' }));
		expect(await screen.findByText('Kein Eintrag passt zu diesen Filtern.')).toBeTruthy();
	});

	it('keeps the list of this tab usable without a connection; the server says so with "Erneut laden"', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await renderPage();
		await fireEvent.click(screen.getByRole('button', { name: 'Server' }));
		expect(
			await screen.findByText(
				'Ohne Verbindung zum Server lässt sich das Fehlerprotokoll nicht laden.'
			)
		).toBeTruthy();
		// The filters stay; "Erneut laden" asks for the first page again.
		expect(screen.getByRole('group', { name: 'Quelle' })).toBeTruthy();
		const filters = serve([item(1)]);
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
		expect(await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
		expect(filters[0]).toContain('("" = "" || last_at < ""');

		await fireEvent.click(screen.getByRole('button', { name: /^Diese Sitzung/ }));
		expect(screen.getByText('In dieser Sitzung ist kein Fehler aufgetreten.')).toBeTruthy();
	});

	it('fits the phone frame: targets of 44 px, long codes and routes wrap, nothing scrolls sideways', () => {
		// In the phone frame only, every segment of a filter is at least a target wide; the height
		// comes from base.css. On the PC the segments keep their width.
		const frame = listSource.slice(listSource.indexOf('@media (max-width: 39.99rem) {'));
		expect(frame).toMatch(
			/^@media \(max-width: 39\.99rem\) \{\s*:global\(:root\[data-mobile-layout='on'\]\) \.filter \.segmented > button \{\s*min-width: var\(--control-height-touch\);/
		);
		expect(listSource.match(/min-width: var\(--control-height-touch\)/g)).toHaveLength(1);
		expect(listSource).toMatch(/\.intent \{[^}]*overflow-wrap: anywhere/);
		expect(listSource).toMatch(/\.meta \{[^}]*overflow-wrap: anywhere/);
		expect(listSource).toMatch(/\.filters \{[^}]*flex-wrap: wrap/);
		expect(pageSource).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
		expect(pageSource).toMatch(
			/<title>Fehlerprotokoll · Einstellungen · becauseyoulovejira<\/title>/
		);
		// No special case for an entry of the address: the root layout opens the dialog for it.
		expect(pageSource).not.toMatch(/serverProblemIdOf|SERVER_PROBLEM_PARAM|searchParams/);
	});
});
