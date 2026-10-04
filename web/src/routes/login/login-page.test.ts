// Component tests for the login page (E1 plan, package 7). The real auth module and SDK run
// against a stubbed fetch; only SvelteKit's navigation and page state are mocked.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from '$lib/auth.svelte';
import { pb } from '$lib/pocketbase';
import LoginPage from './+page.svelte';

const ORIGIN = 'http://localhost:3000';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	page: { url: new URL('http://localhost:3000/login') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const USER = {
	id: 'user0000000001',
	collectionId: '_pb_users_auth_',
	collectionName: 'users',
	email: 'anna@example.com'
};
const GENERIC_MESSAGE = 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.';
// Before the sign-in nobody is known, so the message names no script (KX-1, ADR-0057).
const NETWORK_MESSAGE =
	'Server nicht erreichbar. Bitte prüfen, ob becauseyoulovejira läuft, und erneut versuchen.';
const ADMIN_NOTE = 'Hinweis: Das Admin-Konto gilt nur für die Verwaltung, nicht für die App.';

function stubFetch(respond: () => Response | Promise<Response>) {
	const fetchMock = vi.fn<typeof fetch>(async () => respond());
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function openLoginPage(path = '/login') {
	mocks.page.url = new URL(path, ORIGIN);
	return render(LoginPage);
}

function emailField() {
	return screen.getByLabelText<HTMLInputElement>('E-Mail');
}

function passwordField() {
	return screen.getByLabelText<HTMLInputElement>('Passwort');
}

/** The message uses the error style (ADR-0009) and keeps its icon next to the text. */
function expectErrorStyle(message: HTMLElement) {
	const alert = message.closest('.alert-error');
	expect(alert).not.toBeNull();
	expect(alert?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
	expect(alert?.textContent?.trim()).toBe(message.textContent);
}

async function submitLogin(email = USER.email, password = 'richtiges Passwort') {
	await fireEvent.input(emailField(), { target: { value: email } });
	await fireEvent.input(passwordField(), { target: { value: password } });
	await fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
}

afterEach(() => {
	pb.authStore.clear();
	mocks.goto.mockReset();
	vi.restoreAllMocks();
});

describe('login form', () => {
	it('has visible labels and the autocomplete hints for password managers', () => {
		openLoginPage();

		expect(emailField()).toMatchObject({ type: 'email', required: true });
		expect(emailField().getAttribute('autocomplete')).toBe('username');
		expect(passwordField()).toMatchObject({ type: 'password', required: true });
		expect(passwordField().getAttribute('autocomplete')).toBe('current-password');
	});

	it('focuses the e-mail field on load', async () => {
		openLoginPage();
		await tick();

		expect(document.activeElement).toBe(emailField());
	});

	it('submits with Enter: its only button is the submit button of the form', () => {
		openLoginPage();

		const form = emailField().form;
		const buttons = screen.getAllByRole('button');
		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toMatchObject({ type: 'submit', form });
	});

	it('tells every visitor whom to ask, without pointing end users at the admin UI', () => {
		openLoginPage();

		expect(
			screen.getByText(
				'Kein Zugang oder Passwort vergessen? Wende dich an die Person, die becauseyoulovejira eingerichtet hat.'
			)
		).toBeTruthy();
		expect(screen.getAllByRole('link')).toHaveLength(1);
		const link = screen.getByRole('link', { name: 'Verwaltung (nur Admin)' });
		expect(link.getAttribute('href')).toBe('/_/');
		expect(link.getAttribute('rel')).toBe('external');
	});

	it('has no app header: the login page is outside the (app) layout', () => {
		openLoginPage();

		expect(screen.queryByRole('banner')).toBeNull();
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
	});

	it('never mentions PocketBase to end users', () => {
		const { container } = openLoginPage();

		expect(container.textContent).not.toMatch(/PocketBase/i);
		expect(screen.queryByText(ADMIN_NOTE)).toBeNull();
	});
});

describe('submitting', () => {
	it('calls the auth service and disables the button while the request runs', async () => {
		let respond: (response: Response) => void = () => {};
		stubFetch(() => new Promise<Response>((resolve) => (respond = resolve)));
		const login = vi.spyOn(auth, 'login');
		openLoginPage();

		await submitLogin(USER.email, 'geheim');

		expect(login).toHaveBeenCalledWith(USER.email, 'geheim');
		const button = screen.getByRole('button', { name: 'Anmeldung läuft …' });
		expect(button).toHaveProperty('disabled', true);

		respond(Response.json({ token: 'fresh-token', record: USER }));
		await waitFor(() => expect(mocks.goto).toHaveBeenCalledOnce());
		expect(login).toHaveBeenCalledOnce();
	});

	it('shows the generic message for a 400, then clears and focuses the password', async () => {
		stubFetch(() =>
			Response.json({ status: 400, message: 'Failed to authenticate.', data: {} }, { status: 400 })
		);
		openLoginPage();

		await submitLogin();

		const message = await screen.findByText(GENERIC_MESSAGE);
		expect(message.closest('[aria-live="polite"]')).not.toBeNull();
		expectErrorStyle(message);
		expect(screen.getByText(ADMIN_NOTE).closest('[aria-live="polite"]')).not.toBeNull();
		expect(passwordField().value).toBe('');
		expect(document.activeElement).toBe(passwordField());
		expect(emailField().value).toBe(USER.email);
		expect(screen.getByRole('button', { name: 'Anmelden' })).toHaveProperty('disabled', false);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(pb.authStore.token).toBe('');
	});

	it('shows the network message when no response arrives (status 0)', async () => {
		stubFetch(() => Promise.reject(new TypeError('fetch failed')));
		openLoginPage();

		await submitLogin();

		const message = await screen.findByText(NETWORK_MESSAGE);
		expect(message.closest('[aria-live="polite"]')).not.toBeNull();
		expectErrorStyle(message);
		expect(screen.queryByText(GENERIC_MESSAGE)).toBeNull();
		expect(screen.queryByText(ADMIN_NOTE)).toBeNull();
		expect(document.activeElement).toBe(passwordField());
	});

	it.each([
		[
			429,
			'Zu viele Anmeldeversuche. Zum Schutz vor Rateversuchen ist die Anmeldung kurz gesperrt. Bitte ein paar Minuten warten und dann erneut versuchen.'
		],
		[500, 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.'],
		[503, 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.']
	])('shows an own message for %i, independent of the account', async (status, text) => {
		stubFetch(() => Response.json({ status, message: 'Error', data: {} }, { status }));
		openLoginPage();

		await submitLogin();

		const message = await screen.findByText(text);
		expect(message.closest('[aria-live="polite"]')).not.toBeNull();
		expectErrorStyle(message);
		expect(screen.queryByText(GENERIC_MESSAGE)).toBeNull();
		expect(screen.queryByText(ADMIN_NOTE)).toBeNull();
		expect(passwordField().value).toBe('');
		expect(pb.authStore.token).toBe('');
	});
});

describe('after a successful login', () => {
	it.each([
		['/login', '/'],
		['/login?redirect=%2Ftickets%3Fstatus%3Dopen', '/tickets?status=open']
	])('navigates from %s to the validated redirect %s', async (path, expected) => {
		stubFetch(() => Response.json({ token: 'fresh-token', record: USER }));
		openLoginPage(path);

		await submitLogin();

		await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(expected, { replaceState: true }));
		expect(pb.authStore.token).toBe('fresh-token');
	});

	it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)'])(
		'ignores the malicious redirect %s and navigates to "/"',
		async (redirect) => {
			stubFetch(() => Response.json({ token: 'fresh-token', record: USER }));
			openLoginPage(`/login?${new URLSearchParams({ redirect })}`);

			await submitLogin();

			await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/', { replaceState: true }));
		}
	);
});
