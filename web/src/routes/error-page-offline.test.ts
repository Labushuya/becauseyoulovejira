// The error page without a connection (OF-2, concept OF-0 §3.11): a module that could not be
// loaded does not reload the tab onto the offline page of the browser while the outbox knows the
// connection to be missing; the page says that the view is not loaded yet and offers "Zurück".
// With the connection it reloads as before (error-page.test.ts). Since OF-2b it watches the
// connection itself while the outbox worked in the tab: back online it offers "Neu laden", and it
// asks the server once before it reloads on its own.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_TEXTS } from '$lib/domain/offline';
import { getConnectivity } from '$lib/offline/connectivity.svelte';
import ErrorPage from './+error.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		status: 500,
		error: {
			message: 'Ein Teil der App konnte nicht geladen werden.',
			kind: 'module-load'
		} as App.Error,
		url: new URL('http://192.168.178.66:8090/eingang')
	},
	loadFully: vi.fn<(href: string) => void>(),
	reloadPage: vi.fn<() => void>(),
	/** The outbox of the tab as the page sees it; null for the real one (no storage in jsdom). */
	outbox: null as null | { count: number; inUse: boolean }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/page-reload', () => ({ loadFully: mocks.loadFully, reloadPage: mocks.reloadPage }));
vi.mock('$lib/offline/app-outbox', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/offline/app-outbox')>();
	return { ...original, getOutbox: () => mocks.outbox ?? original.getOutbox() };
});

/** The monitor of the app after a failed check (jsdom has no server for /api/health). */
async function goOffline(): Promise<void> {
	const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
	const connectivity = getConnectivity();
	const stop = connectivity.start(null);
	await connectivity.check();
	stop();
	fetcher.mockRestore();
	expect(connectivity.offline).toBe(true);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
	getConnectivity().reset();
	mocks.outbox = null;
	vi.clearAllMocks();
});

describe('error page without a connection', () => {
	it('does not reload, says the view is not loaded yet and offers "Zurück"', async () => {
		const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
		await goOffline();
		render(ErrorPage);
		expect(mocks.loadFully).not.toHaveBeenCalled();
		const heading = screen.getByRole('heading', { level: 1 });
		expect(heading.textContent).toBe('Ohne Verbindung nicht verfügbar');
		expect(screen.getByText(OFFLINE_TEXTS.notLoaded)).toBeTruthy();
		expect(OFFLINE_TEXTS.notLoaded).toBe(
			'Diese Ansicht ist ohne Verbindung noch nicht geladen. Gemerkte Änderungen bleiben erhalten.'
		);
		expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
		expect(back).toHaveBeenCalledTimes(1);
		back.mockRestore();
	});

	it('reloads as before with the connection', () => {
		render(ErrorPage);
		expect(mocks.loadFully).toHaveBeenCalledWith('http://192.168.178.66:8090/eingang');
	});
});

describe('error page watching the connection itself (OF-2b, G5)', () => {
	it('asks the server again while shown and offers "Neu laden" once the connection is back', async () => {
		await goOffline();
		const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
		render(ErrorPage);
		const heading = screen.getByRole('heading', { level: 1 });
		expect(heading.textContent).toBe('Ohne Verbindung nicht verfügbar');
		// The page asks at once; that check fails, the next one comes with the event of the browser.
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(getConnectivity().checking).toBe(false));
		fetcher.mockResolvedValue(new Response('{}'));
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Neu laden' })).toBeTruthy());
		expect(heading.textContent).toBe('Etwas ist schiefgelaufen');
		expect(mocks.loadFully).not.toHaveBeenCalled();
		fetcher.mockRestore();
	});

	it('asks the server once before it reloads on its own while the outbox works, and stays without an answer', async () => {
		mocks.outbox = { count: 0, inUse: true };
		const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
		render(ErrorPage);
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
				'Ohne Verbindung nicht verfügbar'
			)
		);
		expect(fetcher).toHaveBeenCalledWith('/api/health', expect.anything());
		expect(mocks.loadFully).not.toHaveBeenCalled();
		fetcher.mockRestore();
	});

	it('reloads on its own once that check answered', async () => {
		mocks.outbox = { count: 0, inUse: true };
		const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
		render(ErrorPage);
		await vi.waitFor(() =>
			expect(mocks.loadFully).toHaveBeenCalledWith('http://192.168.178.66:8090/eingang')
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
		fetcher.mockRestore();
	});
});
