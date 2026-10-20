// The login page with changes the outbox kept (OF-2, concept OF-0 §2.1, decision of the user 4):
// it says how many wait and that they go out after the sign-in with the same account, and that
// another account deletes them; only the number, nothing about them. Without kept changes nothing
// changes.

import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	page: { url: new URL('http://localhost:3000/login') },
	kept: vi.fn(async () => 0)
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/offline/app-outbox', () => ({ keptOnDevice: mocks.kept }));

const HINT =
	'3 gemerkte Änderungen warten. Melde dich mit demselben Konto an, dann werden sie übertragen. Mit einem anderen Konto werden sie verworfen.';

describe('login page with kept changes', () => {
	it('says how many changes wait for the same account', async () => {
		mocks.kept.mockResolvedValueOnce(3);
		const { container } = render(LoginPage);
		await vi.waitFor(() => expect(screen.getByText(HINT)).toBeTruthy());
		const message = container.querySelector('.section-message');
		expect(message?.getAttribute('data-tone')).toBe('info');
	});

	it('shows nothing new without kept changes', async () => {
		const { container } = render(LoginPage);
		await tick();
		expect(container.querySelector('.section-message')).toBeNull();
	});
});
