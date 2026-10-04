// Settings "Konto" (plan EH-8; since E7-1, ADR-0056 §3): the signed-in app account with its e-mail,
// its display name and its password, and who manages the accounts: the administrator on "Konten"
// (with the separate admin account of PocketBase), every other account the administrator. The forms
// themselves are tested in own-account-view.test.ts.

import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	auth: {
		email: 'anna@example.com',
		name: 'Anna Beispiel',
		isAdmin: true,
		userId: 'user0000000001',
		ensureValid: () => true,
		logout: () => undefined
	}
}));

vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));
vi.mock('$lib/pocketbase', () => ({ pb: {} }));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/flags.svelte')>();
	return { ...original, getFlagStore: () => original.SILENT_FLAGS };
});

beforeEach(() => {
	mocks.auth.isAdmin = true;
});

describe('account page (EH-8, E7-1)', () => {
	it('shows the signed-in app account with its name and both forms', () => {
		const { container } = render(Page);

		const terms = [...container.querySelectorAll('dt')].map((term) => term.textContent?.trim());
		expect(terms).toEqual(['Angemeldet als', 'Art']);
		expect(container.querySelector('dd')?.textContent?.trim()).toBe('anna@example.com');
		expect(container.textContent).toMatch(/App-Konto/);
		expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Anna Beispiel');
		expect(screen.getByRole('button', { name: 'Name speichern' })).toBeTruthy();
		expect(screen.getByLabelText('Bisheriges Passwort').getAttribute('type')).toBe('password');
		expect(screen.getByLabelText('Neues Passwort').getAttribute('autocomplete')).toBe(
			'new-password'
		);
		expect(screen.getByLabelText('Neues Passwort wiederholen')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Passwort ändern' })).toBeTruthy();
	});

	it('leads the administrator to "Konten" and names the admin account of PocketBase', () => {
		render(Page);

		expect(screen.getByText('Verwalter der App')).toBeTruthy();
		const message = screen
			.getByRole('heading', { name: /Konten verwalten/ })
			.closest('[data-tone]');
		expect(message?.getAttribute('data-tone')).toBe('info');
		const text = (message?.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/Admin-Konto/);
		expect(text).toMatch(/admin-zuruecksetzen\.bat/);
		const scope = within(message as HTMLElement);
		expect(scope.getByRole('link', { name: 'Zu den Konten' }).getAttribute('href')).toBe(
			'/einstellungen/konten'
		);
		const admin = scope.getByRole('link', { name: /Verwaltung öffnen/ });
		expect(admin.getAttribute('href')).toBe('/_/');
		expect(admin.getAttribute('rel')).toBe('external');
	});

	it('tells every other account that the administrator manages accounts', () => {
		mocks.auth.isAdmin = false;
		render(Page);

		expect(screen.queryByText('Verwalter der App')).toBeNull();
		const message = screen
			.getByRole('heading', { name: /Konten verwalten/ })
			.closest('[data-tone]');
		expect((message?.textContent ?? '').replace(/\s+/g, ' ')).toMatch(
			/richtet der Verwalter der App ein/
		);
		const scope = within(message as HTMLElement);
		expect(scope.queryByRole('link', { name: /Verwaltung öffnen/ })).toBeNull();
		expect(scope.getByRole('link', { name: /Mehr zu Konten/ }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#konten'
		);
	});
});
