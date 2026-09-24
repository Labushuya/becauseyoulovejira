// Component tests for the error page (E1.1): German texts and a way back to the start page.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ErrorPage from './+error.svelte';

const mocks = vi.hoisted(() => ({
	page: { status: 404, error: { message: 'Not Found' } }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));

function openErrorPage(status: number) {
	mocks.page.status = status;
	return render(ErrorPage);
}

describe('error page', () => {
	it('explains a missing page in German and links to the start page', () => {
		openErrorPage(404);

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Seite nicht gefunden');
		expect(screen.getByText('Diese Adresse gibt es in becauseyoulovejira nicht.')).toBeTruthy();
		expect(screen.getByText('Fehlercode 404')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Zur Startseite' });
		expect(link.getAttribute('href')).toBe('/');
	});

	it('shows a general message for other errors without technical details', () => {
		const { container } = openErrorPage(500);

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Etwas ist schiefgelaufen');
		expect(screen.getByText('Fehlercode 500')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Zur Startseite' })).toBeTruthy();
		expect(container.textContent).not.toMatch(/Not Found|PocketBase/);
	});
});
