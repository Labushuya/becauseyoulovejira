// Settings "Konto" (plan EH-8): display only. The signed-in e-mail, the kind of account and where
// accounts are managed, with the administration as an external link; no password field and no
// action that changes the account ("Passwort ändern" stays deferred, "Abmelden" is in the header).

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$lib/auth.svelte', () => ({ auth: { email: 'anna@example.com' } }));

describe('account page (EH-8)', () => {
	it('shows the signed-in app account', () => {
		const { container } = render(Page);

		const terms = [...container.querySelectorAll('dt')].map((term) => term.textContent?.trim());
		expect(terms).toEqual(['Angemeldet als', 'Art']);
		expect(container.querySelector('dd')?.textContent?.trim()).toBe('anna@example.com');
		expect(container.textContent).toMatch(/App-Konto/);
	});

	it('explains where accounts are managed and links the administration', () => {
		render(Page);

		const message = screen
			.getByRole('heading', { name: /Konten verwalten/ })
			.closest('[data-tone]');
		expect(message?.getAttribute('data-tone')).toBe('info');
		const text = (message?.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/Collections → users/);
		expect(text).toMatch(/Admin-Konto/);
		expect(text).toMatch(/admin-zuruecksetzen\.bat/);
		const link = within(message as HTMLElement).getByRole('link', { name: /Verwaltung öffnen/ });
		expect(link.getAttribute('href')).toBe('/_/');
		expect(link.getAttribute('rel')).toBe('external');
	});

	it('has no password field and no button', () => {
		const { container } = render(Page);
		expect(container.querySelector('input')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});
});
