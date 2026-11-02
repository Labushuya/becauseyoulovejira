// The error log of the server in the SPA (FP-2, ADR-0077): the dialog of the errors with the switch
// "Diese Sitzung" / "Server", the entries of the server with their facts and "Kopieren" (Server-ID),
// the entry of the address (deep link), a gone entry, no connection (a hint, nothing breaks), no
// session; "Details" at the last error of a card; the entry on the page "Hilfe". The server answers
// through a stubbed fetch, as the record API of problem_events would.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientProblem } from '$lib/domain/problems';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ServerProblemLink from './ServerProblemLink.svelte';
import ServerProblemsEntry from './ServerProblemsEntry.svelte';
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
		await openDialog({ view: 'server' });
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
		await openDialog({ view: 'server' });
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
		await openDialog({ view: 'server' });
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
	it('links to the newest entry of the connection on the current page', async () => {
		const find = vi.fn(async () => NEWER.id);
		render(ServerProblemLink, {
			props: { connection: 'conn00000000001', name: 'Mein Bot', seen: '2026-11-02 x', find }
		});
		const link = await screen.findByRole('link', { name: 'Details: Mein Bot im Fehlerprotokoll' });
		expect(link.getAttribute('href')).toBe(
			`/einstellungen/kanaele?einrichten=telegram&fehler=${NEWER.id}`
		);
		expect(link.classList.contains('button-subtle')).toBe(true);
		expect(link.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		expect(find).toHaveBeenCalledWith('conn00000000001', expect.any(AbortSignal));
	});

	it('asks again for a new state of the card', async () => {
		const find = vi.fn(async () => NEWER.id);
		const { rerender } = render(ServerProblemLink, {
			props: { connection: 'conn00000000001', name: 'Mein Bot', seen: 'eins', find }
		});
		await screen.findByRole('link');
		await rerender({ connection: 'conn00000000001', name: 'Mein Bot', seen: 'zwei', find });
		await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
	});

	it('shows nothing without an entry, when the question fails and outside of the page "Kanäle"', async () => {
		render(ServerProblemLink, {
			props: { connection: 'conn00000000001', name: 'A', seen: 'x', find: async () => null }
		});
		render(ServerProblemLink, {
			props: {
				connection: 'conn00000000002',
				name: 'B',
				seen: 'x',
				find: async () => {
					throw new TypeError('Failed to fetch');
				}
			}
		});
		const fetchMock = serve();
		render(ServerProblemLink, { props: { connection: 'conn00000000003', name: 'C', seen: 'x' } });
		await tick();
		await tick();
		expect(screen.queryByRole('link')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('entry on the page "Hilfe" (FP-2)', () => {
	it('opens the dialog with the log of the server first and explains who sees what', async () => {
		render(ServerProblemsEntry);
		expect(document.body.textContent).toMatch(
			/Einen Eintrag deines privaten Bereichs siehst nur du, auch nicht der Verwalter/
		);
		const button = screen.getByRole('button', { name: 'Fehlerprotokoll des Servers anzeigen' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		await fireEvent.click(button);
		expect(problemLog.dialogOpen).toBe(true);
		expect(problemLog.dialogView).toBe('server');
		problemLog.openDialog();
		expect(problemLog.dialogView).toBe('session');
		problemLog.closeDialog();
	});
});
