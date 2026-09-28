// Component tests for the root layout: session check on start, route guard and the notice when
// the session cannot be checked (E1 plan, package 7), and the second tab of the same browser
// (ADR-0035 section 6). The auth module is replaced by a plain object per test; its behaviour is
// covered in src/lib/auth.test.ts.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionFailure, SessionStatus } from '$lib/auth.svelte';
import { TAB_KEEP_KEY, type TabMessage } from '$lib/tab-presence';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import Layout from './+layout.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	page: { url: new URL('http://localhost:3000/') },
	navigating: { to: null as object | null },
	auth: {
		status: 'checking' as SessionStatus,
		failure: null as SessionFailure | null,
		busy: false,
		isLoggedIn: false,
		email: '',
		restore: vi.fn(async () => {})
	}
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page, navigating: mocks.navigating }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));

const CONTENT = 'Geschützter Inhalt';

async function renderLayout(
	path: string,
	session: Partial<Pick<typeof mocks.auth, 'status' | 'failure' | 'busy' | 'isLoggedIn'>>
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	Object.assign(mocks.auth, session);
	const children = createRawSnippet(() => ({ render: () => `<p>${CONTENT}</p>` }));
	render(Layout, { props: { children } });
	await tick();
}

beforeEach(() => {
	mocks.goto.mockReset();
	mocks.auth.restore.mockClear();
	mocks.navigating.to = null;
	Object.assign(mocks.auth, { status: 'checking', failure: null, busy: false, isLoggedIn: false });
});

describe('session check', () => {
	it('checks the stored session once on start', async () => {
		await renderLayout('/', { status: 'checking' });

		expect(mocks.auth.restore).toHaveBeenCalledOnce();
	});

	it('shows a status and neither page nor redirect while checking', async () => {
		await renderLayout('/', { status: 'checking' });

		expect(screen.getByRole('status').textContent).toBe('Sitzung wird geprüft …');
		expect(screen.queryByText(CONTENT)).toBeNull();
		expect(mocks.goto).not.toHaveBeenCalled();
	});
});

describe('route guard', () => {
	it('sends visitors without a session to the login page with a redirect', async () => {
		await renderLayout('/tickets?status=open', { status: 'ready', isLoggedIn: false });

		expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Ftickets%3Fstatus%3Dopen', {
			replaceState: true
		});
		expect(screen.queryByText(CONTENT)).toBeNull();
	});

	it('shows the page with a session', async () => {
		await renderLayout('/', { status: 'ready', isLoggedIn: true });

		expect(screen.getByText(CONTENT)).toBeTruthy();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the login page without a session', async () => {
		await renderLayout('/login', { status: 'ready', isLoggedIn: false });

		expect(screen.getByText(CONTENT)).toBeTruthy();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('forwards a logged-in user from the login page to "/"', async () => {
		await renderLayout('/login', { status: 'ready', isLoggedIn: true });

		expect(mocks.goto).toHaveBeenCalledWith('/', { replaceState: true });
		expect(screen.queryByText(CONTENT)).toBeNull();
	});

	it('lets a running navigation finish first', async () => {
		mocks.navigating.to = { url: new URL('http://localhost:3000/login') };

		await renderLayout('/', { status: 'ready', isLoggedIn: false });

		expect(mocks.goto).not.toHaveBeenCalled();
	});
});

describe('session notice', () => {
	it('keeps the session and offers a retry when the server is unreachable', async () => {
		await renderLayout('/', { status: 'unreachable', failure: 'network', isLoggedIn: true });

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Server nicht erreichbar');
		expect(
			screen.getByText(/Bitte prüfen, ob becauseyoulovejira gestartet ist \(start\.bat\)/)
		).toBeTruthy();
		expect(document.body.textContent).not.toMatch(/PocketBase/i);
		expect(screen.queryByText(CONTENT)).toBeNull();
		expect(mocks.goto).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

		expect(mocks.auth.restore).toHaveBeenCalledTimes(2);
	});

	it('names an error response of the server differently', async () => {
		await renderLayout('/', { status: 'unreachable', failure: 'server', isLoggedIn: true });

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
			'Sitzung konnte nicht geprüft werden'
		);
	});

	it('disables the retry while the check runs', async () => {
		await renderLayout('/', { status: 'unreachable', failure: 'network', busy: true });

		expect(screen.getByRole('button', { name: 'Wird geprüft …' })).toHaveProperty('disabled', true);
	});
});

describe('second tab of the same browser (ADR-0035 section 6)', () => {
	useOverlayStubs();

	/** BroadcastChannel of several tabs in one test; a tab does not hear itself. */
	class FakeChannel {
		static open = new Set<FakeChannel>();
		readonly #listeners = new Set<(event: MessageEvent) => void>();
		constructor(readonly name: string) {
			FakeChannel.open.add(this);
		}
		postMessage(data: TabMessage) {
			for (const other of FakeChannel.open) {
				if (other === this || other.name !== this.name) continue;
				setTimeout(() => {
					for (const listener of other.#listeners) listener({ data } as MessageEvent);
				}, 0);
			}
		}
		addEventListener(_type: string, listener: (event: MessageEvent) => void) {
			this.#listeners.add(listener);
		}
		removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
			this.#listeners.delete(listener);
		}
		close() {
			FakeChannel.open.delete(this);
		}
	}

	/** Another open tab: answers "hello" with "here" and records what it gets. */
	function openTab() {
		const channel = new FakeChannel('byl-tabs');
		const received: string[] = [];
		channel.addEventListener('message', (event) => {
			const type = (event.data as TabMessage).type;
			received.push(type);
			if (type === 'hello') channel.postMessage({ type: 'here' });
		});
		return received;
	}

	const notice = () =>
		screen.queryByRole('dialog', { hidden: true, name: 'Die App ist schon offen' });

	beforeEach(() => {
		FakeChannel.open.clear();
		sessionStorage.removeItem(TAB_KEEP_KEY);
		vi.stubGlobal('BroadcastChannel', FakeChannel);
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
			{ type: 'navigate' } as unknown as PerformanceEntry
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		sessionStorage.removeItem(TAB_KEEP_KEY);
	});

	it('asks the open tab for its hint and offers to close this one', async () => {
		const received = openTab();
		await renderLayout('/', { status: 'ready', isLoggedIn: true });

		await vi.waitFor(() => expect(notice()).not.toBeNull());
		expect(received).toEqual(['hello', 'attention']);
		expect(screen.getByText(CONTENT)).toBeTruthy();
	});

	it('keeps this tab for the session with "Hier weiterarbeiten" and answers other tabs then', async () => {
		openTab();
		await renderLayout('/login', { status: 'ready', isLoggedIn: false });
		await vi.waitFor(() => expect(notice()).not.toBeNull());

		await fireEvent.click(screen.getByRole('button', { name: 'Hier weiterarbeiten' }));
		await tick();

		expect(notice()).toBeNull();
		expect(sessionStorage.getItem(TAB_KEEP_KEY)).toBe('1');
		const later = new FakeChannel('byl-tabs');
		const answers: string[] = [];
		later.addEventListener('message', (event) => answers.push((event.data as TabMessage).type));
		later.postMessage({ type: 'hello' });
		await vi.waitFor(() => expect(answers).toContain('here'));
	});

	it('stays without notice when no other tab answers', async () => {
		await renderLayout('/', { status: 'ready', isLoggedIn: true });
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(notice()).toBeNull();
	});

	it('does not ask after a reload', async () => {
		vi.mocked(performance.getEntriesByType).mockReturnValue([
			{ type: 'reload' } as unknown as PerformanceEntry
		]);
		const received = openTab();
		await renderLayout('/', { status: 'ready', isLoggedIn: true });
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(received).toEqual([]);
		expect(notice()).toBeNull();
	});
});
