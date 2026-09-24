// Component tests for the start page (E1 plan, package 7): header only, the core view follows in E2.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pb } from '$lib/pocketbase';
import StartPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const USER = {
	id: 'user0000000001',
	collectionId: '_pb_users_auth_',
	collectionName: 'users',
	email: 'anna@example.com'
};

beforeEach(() => {
	pb.authStore.save('stored-token', USER);
});

afterEach(() => {
	pb.authStore.clear();
	mocks.goto.mockReset();
});

describe('start page', () => {
	it('shows the app name and the signed-in user in the header', () => {
		const { container } = render(StartPage);

		expect(screen.getByRole('heading', { level: 1, name: 'becauseyoulovejira' })).toBeTruthy();
		expect(screen.getByText(/^Angemeldet als/).textContent).toBe(`Angemeldet als ${USER.email}`);
		expect(container.firstElementChild?.tagName).toBe('HEADER');
	});

	it('shows an empty state until the ticket view exists, without placeholder content', () => {
		const { container } = render(StartPage);

		const main = screen.getByRole('main');
		expect(main.textContent?.trim()).toBe(
			'Hier erscheinen bald deine Tickets – die Ticketansicht folgt in der nächsten Ausbaustufe.'
		);
		expect(main.querySelectorAll('*')).toHaveLength(1);
		expect(Array.from(container.children, (child) => child.tagName)).toEqual(['HEADER', 'MAIN']);
	});

	it('ends the session and goes to the login page', async () => {
		render(StartPage);

		await fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));

		expect(pb.authStore.token).toBe('');
		expect(pb.authStore.record).toBeNull();
		expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true });
	});
});
