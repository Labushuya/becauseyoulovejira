// The error log of the server in the SPA (FP-2, ADR-0077): the dialog of the errors with the switch
// "Diese Sitzung" / "Server", the entries of the server with their facts and "Kopieren" (Server-ID),
// the entry of the address (deep link), a gone entry, no connection (a hint, nothing breaks), no
// session; "Details" at the last error of a card; since FP-3 the way from the dialog to the page
// "Fehlerprotokoll". The server answers through a stubbed fetch, as the record API of problem_events
// would.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientProblem } from '$lib/domain/problems';
import { problemLog } from '$lib/stores/problem-log.svelte';
import {
	ChannelProblemsStore,
	type ChannelProblemsFinder
} from '$lib/stores/server-problems.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ServerProblemLink from './ServerProblemLink.svelte';
import SessionProblemsDialog from './SessionProblemsDialog.svelte';

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://127.0.0.1:8090/einstellungen/kanaele?einrichten=telegram') }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const NEWER = {
	id: 'newer000000001a',
	source: 'channel',
	area: 'private',
	code: 'channel_error',
	message: 'Telegram antwortet mit HTTP 401.',
	context: { connection: 'conn00000000001', channel: 'telegram' },
	count: 4,
	first_at: '2026-11-01 08:00:00.000Z',
	last_at: '2026-11-02 09:30:00.000Z'
};
const OLDER = {
	id: 'older000000001a',
	source: 'job',
	area: 'system',
	code: 'trash_failed',
	message: 'Papierkorb: Lauf gescheitert',
	context: { job: 'trash' },
	count: 1,
	first_at: '2026-10-30 08:00:00.000Z',
	last_at: '2026-10-30 08:00:00.000Z'
};
const LINKED = {
	...OLDER,
	id: 'linked00000001a',
	area: 'household',
	last_at: '2026-10-20 08:00:00.000Z',
	first_at: '2026-10-20 08:00:00.000Z'
};

/** The record API of problem_events: the list, one entry, 404 for any other. */
function serve(items: unknown[] = [NEWER, OLDER], single: unknown[] = [NEWER, OLDER, LINKED]) {
	const fetchMock = vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/problem_events/records')) {
			return Response.json({ page: 1, perPage: 50, totalItems: -1, totalPages: -1, items });
		}
		const id = url.pathname.split('/').at(-1);
		const found = single.find((entry) => (entry as { id: string }).id === id);
		return found === undefined
			? Response.json({ status: 404, message: 'Not found.', data: {} }, { status: 404 })
			: Response.json(found);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function openDialog(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	render(SessionProblemsDialog, { props: { onclose, ...props } });
	await tick();
	await tick();
	return { onclose };
}

/** The dialog with the list of the server: opened at this tab, then "Server". */
async function openServer() {
	const opened = await openDialog();
	await fireEvent.click(screen.getByRole('button', { name: 'Server' }));
	return opened;
}

beforeEach(() => {
	problemLog.clear();
	problemLog.closeDialog();
});

afterEach(() => vi.unstubAllGlobals());

describe('dialog of the errors with the log of the server (FP-2)', () => {
	it('switches between this session and the server; the title names the shown list', async () => {
		serve();
		problemLog.record(
			clientProblem({
				id: 'p-1',
				intent: 'Ticket speichern',
				at: Date.now(),
				outcome: { result: 'network', status: null, code: null, message: null },
				request: null,
				app: null,
				exception: null
			})
		);
		await openDialog();
		const switcher = screen.getByRole('group', { name: 'Welche Fehler' });
		const session = within(switcher).getByRole('button', { name: 'Diese Sitzung (1)' });
		const server = within(switcher).getByRole('button', { name: 'Server' });
		expect(screen.getByRole('dialog', { name: 'Fehler dieser Sitzung' })).toBeTruthy();
		expect(session.getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(server);
		expect(screen.getByRole('dialog', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
		expect(server.getAttribute('aria-pressed')).toBe('true');
		expect(session.getAttribute('aria-pressed')).toBe('false');
		await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });

		await fireEvent.click(session);
		expect(screen.getByRole('list', { name: 'Fehler dieser Sitzung' })).toBeTruthy();
	});

	it('lists the entries newest first and copies a report with the Server-ID', async () => {
		serve();
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		await openServer();
		const list = await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });
		const items = within(list).getAllByRole('listitem');
		expect(items.map(text)).toEqual([
			'Kanal im Hintergrund abrufen: Telegram 4× 02.11.2026, 10:30:00 · Vom Server gemeldeter Fehler Details: Kanal im Hintergrund abrufen: Telegram, 02.11.2026, 10:30:00',
			'Papierkorb aufräumen 30.10.2026, 09:00:00 · Vom Server gemeldeter Fehler Details: Papierkorb aufräumen, 30.10.2026, 09:00:00'
		]);
		const toggle = within(items[0] as HTMLElement).getByRole('button', { name: /^Details: Kanal/ });
		await fireEvent.click(toggle);
		const panel = document.getElementById(
			toggle.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		expect(text(panel)).toContain('Bereich Privat, nur für dich');
		expect(text(panel)).toContain(`Server-ID ${NEWER.id}`);
		expect(text(panel)).not.toContain('App-Stand');
		await fireEvent.click(within(panel).getByRole('button', { name: 'Kopieren' }));
		await tick();
		expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Server-ID: ${NEWER.id}`));
		expect(screen.getByText(/30 Tage nach seinem letzten Auftreten, höchstens 5000/)).toBeTruthy();
	});

	it('opens at the entry of the address: first, unfolded, marked and with the focus', async () => {
		const fetchMock = serve();
		await openDialog({ focus: LINKED.id });
		expect(screen.getByRole('dialog', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
		const list = await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' });
		const [first] = within(list).getAllByRole('listitem');
		expect(text(first as HTMLElement)).toMatch(/^Papierkorb aufräumen Verlinkter Eintrag/);
		expect(
			within(first as HTMLElement)
				.getByRole('button', { name: /^Details/ })
				.getAttribute('aria-expanded')
		).toBe('true');
		expect(text(first as HTMLElement)).toContain('Bereich Haushalt, für alle Mitglieder');
		await waitFor(() => expect(document.activeElement).toBe(first));
		expect(within(list).getAllByRole('listitem')).toHaveLength(3);
		const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
		expect(urls.some((url) => url.pathname.endsWith(`/problem_events/records/${LINKED.id}`))).toBe(
			true
		);
		for (const url of urls) expect(url.searchParams.get('filter')).toBeNull();
		// Unchanged since FP-3: the newest 50, no "Mehr laden" and no filters in the dialog.
		const listed = urls.find((url) => url.pathname.endsWith('/problem_events/records'));
		expect(listed?.searchParams.get('perPage')).toBe('50');
		expect(listed?.searchParams.get('sort')).toBe('-last_at,-id');
		expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
		expect(screen.queryByRole('group', { name: 'Quelle' })).toBeNull();
	});

	it('says that a linked entry is gone or not visible and keeps the list', async () => {
		serve();
		await openDialog({ focus: 'gone00000000001' });
		expect(await screen.findByText(/Diesen Eintrag gibt es nicht mehr/)).toBeTruthy();
		const list = screen.getByRole('list', { name: 'Fehlerprotokoll des Servers' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		expect(within(list).queryByText('Verlinkter Eintrag')).toBeNull();
	});

	it('says that the server keeps nothing the account may see', async () => {
		serve([]);
		await openServer();
		expect(
			await screen.findByText('Der Server hat keinen Fehler festgehalten, den du sehen darfst.')
		).toBeTruthy();
	});

	it('shows a hint without a connection, nothing breaks, and loads again on "Erneut laden"', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await openServer();
		expect(
			await screen.findByText(
				'Ohne Verbindung zum Server lässt sich das Fehlerprotokoll nicht laden.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();
		serve();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
		expect(await screen.findByRole('list', { name: 'Fehlerprotokoll des Servers' })).toBeTruthy();
	});

	it('shows only the list of this tab without a session, and asks the server nothing', async () => {
		const fetchMock = serve();
		await openDialog({ signedIn: false, focus: NEWER.id });
		expect(screen.getByRole('dialog', { name: 'Fehler dieser Sitzung' })).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Welche Fehler' })).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('"Details" at the last error of a channel card (FP-2)', () => {
	const RUN = '2026-11-02 09:30:00.000Z';
	const card = (index: number, overrides: Record<string, unknown> = {}) => ({
		connection: `conn0000000000${index}`,
		name: `Karte ${index}`,
		lastError: `Fehler ${index}`,
		lastRunAt: RUN,
		...overrides
	});
	/** The finder of the page with an entry of every asked connection at `lastAt`. */
	const finder = (lastAt = Date.UTC(2026, 10, 2, 9, 30, 0, 5)) =>
		vi.fn<ChannelProblemsFinder>(async (connections) =>
			connections.map((connection) => ({
				id: `${connection}`.replace('conn', 'prob'),
				connection,
				lastAt
			}))
		);

	it('links to the entry of its error on the current page', async () => {
		const watch = vi.fn(() => () => undefined);
		const problems = { watch, idOf: vi.fn(() => NEWER.id) };
		render(ServerProblemLink, { props: { ...card(1, { name: 'Mein Bot' }), problems } });
		const link = await screen.findByRole('link', { name: 'Details: Mein Bot im Fehlerprotokoll' });
		expect(link.getAttribute('href')).toBe(
			`/einstellungen/kanaele?einrichten=telegram&fehler=${NEWER.id}`
		);
		expect(link.classList.contains('button-subtle')).toBe(true);
		expect(link.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		expect(watch).toHaveBeenCalledWith({
			connection: 'conn00000000001',
			lastError: 'Fehler 1',
			lastRunAt: RUN
		});
	});

	it('asks one query for the cards of the page and once more for a new error', async () => {
		const find = finder();
		const problems = new ChannelProblemsStore(find, 0);
		const views = [1, 2, 3, 4, 5].map((index) =>
			render(ServerProblemLink, { props: { ...card(index), problems } })
		);
		await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(5));
		expect(find).toHaveBeenCalledTimes(1);
		expect(find.mock.calls[0]?.[0]).toEqual(
			[1, 2, 3, 4, 5].map((index) => `conn0000000000${index}`)
		);

		await views[1]?.rerender({
			...card(2, { lastError: 'Neuer Fehler', lastRunAt: '2026-11-02 09:32:00.000Z' }),
			problems
		});
		await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
		problems.stop();
	});

	it('shows no link for an entry older than the run of the card: it belongs to another error', async () => {
		// One query: an entry of 09:30 for both cards; the second card ran at 10:00 with another error.
		const problems = new ChannelProblemsStore(finder(), 0);
		render(ServerProblemLink, { props: { ...card(1), problems } });
		render(ServerProblemLink, {
			props: { ...card(2, { name: 'Später', lastRunAt: '2026-11-02 10:00:00.000Z' }), problems }
		});
		expect(
			await screen.findByRole('link', { name: 'Details: Karte 1 im Fehlerprotokoll' })
		).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Details: Später im Fehlerprotokoll' })).toBeNull();
		problems.stop();
	});

	it('shows nothing without an entry, when the question fails and outside of the page "Kanäle"', async () => {
		render(ServerProblemLink, {
			props: { ...card(1), problems: new ChannelProblemsStore(async () => [], 0) }
		});
		const failing = vi.fn<ChannelProblemsFinder>(async () => {
			throw new TypeError('Failed to fetch');
		});
		render(ServerProblemLink, {
			props: { ...card(2), problems: new ChannelProblemsStore(failing, 0) }
		});
		const fetchMock = serve();
		render(ServerProblemLink, { props: card(3) });
		await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
		await tick();
		expect(screen.queryByRole('link')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('way from the dialog to the page "Fehlerprotokoll" (FP-3)', () => {
	it('leads there in the footer and closes the dialog of the list', async () => {
		serve();
		problemLog.openDialog();
		const { onclose } = await openDialog();
		const link = screen.getByRole('link', { name: 'Fehlerprotokoll öffnen' });
		expect(link.getAttribute('href')).toBe('/einstellungen/fehlerprotokoll');
		expect(link.classList.contains('button-subtle')).toBe(true);
		// jsdom does not navigate; in the app SvelteKit follows the link.
		const stay = (event: Event) => event.preventDefault();
		document.addEventListener('click', stay, { capture: true, once: true });
		await fireEvent.click(link);
		expect(problemLog.dialogOpen).toBe(false);
		// Not the closing of the layout: it would take ?fehler out of the address with a navigation of
		// its own, which could replace the one of the link.
		expect(onclose).not.toHaveBeenCalled();
	});

	it('offers no way there without a session: the page needs one', async () => {
		await openDialog({ signedIn: false });
		expect(screen.queryByRole('link', { name: 'Fehlerprotokoll öffnen' })).toBeNull();
		expect(screen.getByText('Schließen')).toBeTruthy();
	});
});
