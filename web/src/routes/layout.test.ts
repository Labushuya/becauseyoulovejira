// Component tests for the root layout: session check on start, route guard and the notice when
// the session cannot be checked (E1 plan, package 7). The auth module is replaced by a plain
// object per test; its behaviour is covered in src/lib/auth.test.ts.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionFailure, SessionStatus } from '$lib/auth.svelte';
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
