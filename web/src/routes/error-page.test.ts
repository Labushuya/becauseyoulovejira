// Component tests for the error page (E1.1, ADR-0040): German texts, "Neu laden" and a way back to
// the overview, and a module that could not be loaded after a new build loads the address once
// more by itself, but never twice in a row.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_ATTEMPT_KEY } from '$lib/app-update';
import ErrorPage from './+error.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		status: 404,
		error: { message: 'Not Found' } as App.Error,
		url: new URL('http://127.0.0.1:8090/projekte')
	},
	loadFully: vi.fn<(href: string) => void>(),
	reloadPage: vi.fn<() => void>()
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/page-reload', () => ({ loadFully: mocks.loadFully, reloadPage: mocks.reloadPage }));

const MODULE_LOAD: App.Error = {
	message: 'Ein Teil der App konnte nicht geladen werden.',
	kind: 'module-load'
};

function openErrorPage(status: number, error: App.Error = { message: 'Internal Error' }) {
	mocks.page.status = status;
	mocks.page.error = error;
	return render(ErrorPage);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.clearAllMocks());

describe('error page', () => {
	it('explains a missing page in German and links to the overview', () => {
		openErrorPage(404, { message: 'Not Found' });

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Seite nicht gefunden');
		expect(screen.getByText('Diese Adresse gibt es in becauseyoulovejira nicht.')).toBeTruthy();
		expect(screen.getByText('Fehlercode 404')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Zur Übersicht' });
		expect(link.getAttribute('href')).toBe('/');
		expect(link.hasAttribute('data-sveltekit-reload')).toBe(true);
		expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
	});

	it('shows a general message for other errors without technical details', async () => {
		const { container } = openErrorPage(500);

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Etwas ist schiefgelaufen');
		expect(screen.getByText('Fehlercode 500')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Zur Übersicht' })).toBeTruthy();
		expect(container.textContent).not.toMatch(/Internal Error|Not Found|PocketBase/);
		await fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
		expect(mocks.reloadPage).toHaveBeenCalledOnce();
		expect(mocks.loadFully).not.toHaveBeenCalled();
	});

	it('loads the address once more when a module could not be loaded', () => {
		openErrorPage(500, MODULE_LOAD);

		expect(mocks.loadFully).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8090/projekte');
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
			'Neue Version wird geladen …'
		);
		expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
		expect(JSON.parse(sessionStorage.getItem(RELOAD_ATTEMPT_KEY) ?? '{}')).toMatchObject({
			href: 'http://127.0.0.1:8090/projekte'
		});
	});

	it('offers "Neu laden" instead of loading the same address a second time', async () => {
		sessionStorage.setItem(
			RELOAD_ATTEMPT_KEY,
			JSON.stringify({ href: 'http://127.0.0.1:8090/projekte', at: Date.now() - 1000 })
		);
		openErrorPage(500, MODULE_LOAD);

		expect(mocks.loadFully).not.toHaveBeenCalled();
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Etwas ist schiefgelaufen');
		expect(screen.getByText(/Ein Teil der App konnte nicht geladen werden/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
		expect(mocks.reloadPage).toHaveBeenCalledOnce();
	});
});
