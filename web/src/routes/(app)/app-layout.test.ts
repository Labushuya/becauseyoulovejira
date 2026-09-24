// Component tests for the app layout (E2 plan, package 2): header on every page of the (app)
// group, keep-alive for the session while it is shown, logout. The auth module is replaced by a
// plain object; its behaviour is covered in src/lib/auth.test.ts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './+layout.svelte';
import StartPage from './+page.svelte';

const mocks = vi.hoisted(() => {
	const stopKeepAlive = vi.fn();
	const calls: string[] = [];
	return {
		calls,
		stopKeepAlive,
		goto: vi.fn(async () => {
			calls.push('goto');
		}),
		page: { url: new URL('http://localhost:3000/') },
		auth: {
			email: 'anna@example.com',
			keepAlive: vi.fn(() => stopKeepAlive),
			logout: vi.fn(() => {
				calls.push('logout');
			})
		}
	};
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));

const CONTENT = 'Seiteninhalt';

async function renderLayout(path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const children = createRawSnippet(() => ({ render: () => `<p>${CONTENT}</p>` }));
	const result = render(Layout, { props: { children } });
	await tick();
	return result;
}

beforeEach(() => {
	mocks.calls.length = 0;
	mocks.goto.mockClear();
	mocks.auth.keepAlive.mockClear();
	mocks.auth.logout.mockClear();
	mocks.stopKeepAlive.mockClear();
});

describe('app layout', () => {
	it('shows the header with app name, area switch and the signed-in user above the page', async () => {
		await renderLayout();

		const header = screen.getByRole('banner');
		expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
			'becauseyoulovejira'
		);
		expect(within(header).getByRole('group', { name: 'Bereich' })).toBeTruthy();
		expect(within(header).getByText(/^Angemeldet als/).textContent).toBe(
			'Angemeldet als anna@example.com'
		);
		expect(within(header).getByRole('button', { name: 'Abmelden' })).toBeTruthy();
		expect(within(screen.getByRole('main')).getByText(CONTENT)).toBeTruthy();
	});

	it('keeps the session alive while shown and stops when it goes away', async () => {
		const { unmount } = await renderLayout();

		expect(mocks.auth.keepAlive).toHaveBeenCalledOnce();
		expect(mocks.stopKeepAlive).not.toHaveBeenCalled();

		unmount();

		expect(mocks.stopKeepAlive).toHaveBeenCalledOnce();
		expect(mocks.auth.keepAlive).toHaveBeenCalledOnce();
	});

	it('logs out and goes to the login page with the current page as redirect', async () => {
		await renderLayout('/tickets/abc123def456ghi?erledigte=1');

		await fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));

		expect(mocks.calls).toEqual(['logout', 'goto']);
		expect(mocks.goto).toHaveBeenCalledWith(
			'/login?redirect=%2Ftickets%2Fabc123def456ghi%3Ferledigte%3D1',
			{ replaceState: true }
		);
	});

	it('logs out from the start page to the plain login page', async () => {
		await renderLayout('/');

		await fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));

		expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true });
	});

	it('keeps the login page outside the (app) group, so it has no header', () => {
		const routes = join(import.meta.dirname, '..');
		expect(existsSync(join(routes, 'login', '+page.svelte'))).toBe(true);
		expect(existsSync(join(import.meta.dirname, 'login'))).toBe(false);
		expect(existsSync(join(routes, '+page.svelte'))).toBe(false);
	});
});

describe('start page', () => {
	it('shows the empty state until the ticket list replaces it', () => {
		const { container } = render(StartPage);

		expect(container.textContent?.trim()).toBe(
			'Hier erscheinen bald deine Tickets – die Ticketansicht folgt in der nächsten Ausbaustufe.'
		);
		expect(container.textContent).not.toMatch(/PocketBase/i);
	});
});
