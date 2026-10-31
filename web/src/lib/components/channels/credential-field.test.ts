// Component tests of the access data in the browser (BW-3, ADR-0075): the state of a variable in
// the user environment of the PC, "Setzen"/"Ersetzen" with a password field that is never filled
// in and empty after every submit, the warning about spaces at the ends, "Entfernen" with the
// question that names the channels, the question "Jetzt neu starten" / "Später" after a change and
// the lasting hint until the restart, "Nur am PC möglich" on another device, and that no value
// lands in the storage of the browser or the outbox, also without a connection. The data layers
// are fakes; the stores and the building blocks are real.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialAnswer, CredentialChange } from '$lib/data/credentials';
import { DataError } from '$lib/data/errors';
import { CREDENTIAL_MESSAGES, CREDENTIAL_TEXTS, PC_ONLY } from '$lib/domain/credentials';
import { RESTART_TEXTS } from '$lib/domain/system';
import { connectionOf } from '$lib/test/connections-fake';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import {
	credentialsStoreOf,
	fakeCredentialsData,
	okAnswer,
	variableOf,
	type FakeCredentialsData
} from '$lib/test/credentials-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakeRestartData, restartStoreOf } from '$lib/test/restart-fake';
import type { RestartStore } from '$lib/stores/restart.svelte';
import CredentialRestartNotice from './CredentialRestartNotice.svelte';
import CredentialsBlock from './CredentialsBlock.svelte';

useOverlayStubs();

const MARKER = 'Marker-Wert-9f2c41';
const BOT = connectionOf({
	id: 'conn00000000007',
	type: 'telegram',
	label: 'Telegram-Bot',
	secretEnv: 'BYL_TELEGRAM_TOKEN',
	allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
});

async function renderBlock(
	data: FakeCredentialsData = fakeCredentialsData([
		variableOf('BYL_TELEGRAM_TOKEN', { set: true, channels: ['Telegram-Bot', 'Zweiter Bot'] }),
		variableOf('BYL_TELEGRAM_ALLOWED_IDS', { set: false, channels: ['Telegram-Bot'] })
	]),
	restart: RestartStore | null = restartStoreOf()
) {
	const store = credentialsStoreOf(data);
	await store.load();
	render(CredentialsBlock, { props: { id: 'zugang', connection: BOT, store, restart } });
	await tick();
	return { store, data, restart };
}

/** The group of one variable, found by its name. */
const field = (name: string) => screen.getByRole('group', { name });

async function openForm(name: string, action: RegExp = /^(Setzen|Ersetzen) …$/) {
	await fireEvent.click(within(field(name)).getByRole('button', { name: action }));
	await tick();
	return within(field(name)).getByLabelText(`Neuer Wert für ${name}`) as HTMLInputElement;
}

async function submit(name: string, value: string) {
	const input = await openForm(name);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.click(within(field(name)).getByRole('button', { name: 'Speichern' }));
	await tick();
	return input;
}

beforeEach(async () => {
	sessionStorage.clear();
	localStorage.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the state and the actions at the field of a channel (V1)', () => {
	it('names each variable with its state in the user environment and the matching actions', async () => {
		await renderBlock();
		expect(screen.getByRole('heading', { name: 'Zugangsdaten' })).toBeTruthy();
		const token = field('BYL_TELEGRAM_TOKEN');
		expect(within(token).getByText('gesetzt')).toBeTruthy();
		expect(within(token).getByRole('button', { name: 'Ersetzen …' })).toBeTruthy();
		expect(within(token).getByRole('button', { name: 'Entfernen …' })).toBeTruthy();
		const ids = field('BYL_TELEGRAM_ALLOWED_IDS');
		expect(within(ids).getByText('fehlt')).toBeTruthy();
		expect(within(ids).getByRole('button', { name: 'Setzen …' })).toBeTruthy();
		expect(within(ids).queryByRole('button', { name: 'Entfernen …' })).toBeNull();
		// The emergency way names the real files, only for the administrator at the PC (V6).
		expect(screen.getByText(/Notfall: .*setx.*neu-starten\.bat im Ordner app/)).toBeTruthy();
	});

	it('sets a value through a password field that is never filled in and empty after the submit', async () => {
		const { data } = await renderBlock();
		const input = await openForm('BYL_TELEGRAM_ALLOWED_IDS');
		expect(input.type).toBe('password');
		expect(input.getAttribute('autocomplete')).toBe('new-password');
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
		await fireEvent.input(input, { target: { value: '  12345  ' } });
		// Spaces at the ends stay, with a warning (S8).
		expect(
			within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByText(CREDENTIAL_TEXTS.outerSpace)
		).toBeTruthy();
		await fireEvent.click(
			within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByRole('button', { name: 'Speichern' })
		);
		expect(data.set).toHaveBeenCalledWith('BYL_TELEGRAM_ALLOWED_IDS', '  12345  ');
		await vi.waitFor(() =>
			expect(within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByText('gesetzt')).toBeTruthy()
		);
		expect(input.value).toBe('');
		await vi.waitFor(() =>
			expect(screen.getByText(/BYL_TELEGRAM_ALLOWED_IDS ist gesetzt\./)).toBeTruthy()
		);
		// The question of the restart follows; "Später" closes it.
		const question = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'Jetzt neu starten?' })
		);
		await fireEvent.click(within(question).getByRole('button', { name: 'Später' }));
		// Now set: the action says "Ersetzen …" and the field opens empty again.
		const again = await openForm('BYL_TELEGRAM_ALLOWED_IDS', /^Ersetzen …$/);
		expect(again.value).toBe('');
	});

	it('refuses an empty value and control characters before a request, and empties the field', async () => {
		const { data } = await renderBlock();
		const input = await submit('BYL_TELEGRAM_ALLOWED_IDS', '   ');
		expect(
			within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByText(CREDENTIAL_MESSAGES.empty)
		).toBeTruthy();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.value).toBe('');
		// A field of one line drops line breaks itself; a tab or NUL stays and is refused.
		await fireEvent.input(input, { target: { value: `a\tb${MARKER}` } });
		await fireEvent.click(
			within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByRole('button', { name: 'Speichern' })
		);
		await tick();
		expect(
			within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByText(CREDENTIAL_MESSAGES.control)
		).toBeTruthy();
		expect(input.value).toBe('');
		expect(data.set).not.toHaveBeenCalled();
	});

	it('shows a refusal of the server at the field and empties it as after a success', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS')
		]);
		data.set.mockResolvedValueOnce({
			kind: 'invalid',
			problem: 'long',
			message: CREDENTIAL_MESSAGES.long
		});
		await renderBlock(data);
		const input = await submit('BYL_TELEGRAM_TOKEN', MARKER);
		await vi.waitFor(() =>
			expect(within(field('BYL_TELEGRAM_TOKEN')).getByText(CREDENTIAL_MESSAGES.long)).toBeTruthy()
		);
		expect(input.value).toBe('');
		expect(document.body.textContent).not.toContain(MARKER);
	});

	it('sends nothing while a change runs and empties the field all the same (S7)', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS')
		]);
		let answer: (value: CredentialAnswer<CredentialChange>) => void = () => undefined;
		data.set.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					answer = resolve;
				})
		);
		await renderBlock(data);
		const input = await submit('BYL_TELEGRAM_TOKEN', MARKER);
		const group = field('BYL_TELEGRAM_TOKEN');
		const saving = within(group).getByRole('button', { name: CREDENTIAL_TEXTS.saving });
		expect(saving.getAttribute('aria-disabled')).toBe('true');
		// Typed and submitted while the first change hangs: nothing goes out, the field is empty.
		await fireEvent.input(input, { target: { value: `${MARKER}-zwei` } });
		await fireEvent.click(saving);
		await tick();
		expect(input.value).toBe('');
		expect(data.set).toHaveBeenCalledTimes(1);
		answer(okAnswer({ name: 'BYL_TELEGRAM_TOKEN', set: true, restartNeeded: true }));
		await vi.waitFor(() =>
			expect(screen.getByText(/BYL_TELEGRAM_TOKEN ist gesetzt\./)).toBeTruthy()
		);
		expect(data.set).toHaveBeenCalledTimes(1);
		expect(document.body.textContent).not.toContain(MARKER);
	});

	it('forgets a typed value when the tab may no longer act, and opens empty again (S7)', async () => {
		await renderBlock();
		const input = await openForm('BYL_TELEGRAM_ALLOWED_IDS');
		await fireEvent.input(input, { target: { value: MARKER } });
		// Allowed, then not (another device), then allowed again.
		await useContext(REMOTE_CONTEXT);
		await tick();
		const label = 'Neuer Wert für BYL_TELEGRAM_ALLOWED_IDS';
		expect(within(field('BYL_TELEGRAM_ALLOWED_IDS')).queryByLabelText(label)).toBeNull();
		await useContext(PC_CONTEXT);
		await tick();
		const again = within(field('BYL_TELEGRAM_ALLOWED_IDS')).getByLabelText(
			label
		) as HTMLInputElement;
		expect(again.value).toBe('');
		expect(document.body.textContent).not.toContain(MARKER);
	});

	it('names too many requests neutrally when reading the state is refused (rate)', async () => {
		const data = fakeCredentialsData();
		data.status.mockResolvedValueOnce({ kind: 'denied', reason: 'rate', problem: null });
		await renderBlock(data);
		expect(
			screen.getByText(
				'Zu viele Anfragen in kurzer Zeit. Warte eine Minute und versuche es dann erneut.'
			)
		).toBeTruthy();
		expect(document.body.textContent).not.toMatch(/Zu viele Änderungen/);
	});
});

describe('"Entfernen" (V2)', () => {
	it('asks first and names every channel of the instance that uses the variable', async () => {
		const { data } = await renderBlock();
		await fireEvent.click(
			within(field('BYL_TELEGRAM_TOKEN')).getByRole('button', { name: 'Entfernen …' })
		);
		const question = screen.getByRole('dialog', { name: 'BYL_TELEGRAM_TOKEN entfernen?' });
		expect(
			within(question).getByText('Diese Kanäle betrifft das: Telegram-Bot, Zweiter Bot.')
		).toBeTruthy();
		expect(within(question).getByText(CREDENTIAL_TEXTS.removeEffect)).toBeTruthy();
		expect(data.remove).not.toHaveBeenCalled();
		await fireEvent.click(within(question).getByRole('button', { name: 'Entfernen' }));
		await vi.waitFor(() => expect(data.remove).toHaveBeenCalledWith('BYL_TELEGRAM_TOKEN'));
		await vi.waitFor(() =>
			expect(within(field('BYL_TELEGRAM_TOKEN')).getByText('fehlt')).toBeTruthy()
		);
	});

	it('says when no channel uses the variable', async () => {
		await renderBlock(
			fakeCredentialsData([
				variableOf('BYL_TELEGRAM_TOKEN'),
				variableOf('BYL_TELEGRAM_ALLOWED_IDS')
			])
		);
		await fireEvent.click(
			within(field('BYL_TELEGRAM_TOKEN')).getByRole('button', { name: 'Entfernen …' })
		);
		const question = screen.getByRole('dialog', { name: 'BYL_TELEGRAM_TOKEN entfernen?' });
		expect(within(question).getByText(CREDENTIAL_TEXTS.removeUnused)).toBeTruthy();
	});
});

describe('the restart after a change (V3)', () => {
	it('asks "Jetzt neu starten" or "Später"; "Später" leaves the lasting hint of the server', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS', { set: false })
		]);
		const restartData = fakeRestartData();
		const { store } = await renderBlock(data, restartStoreOf(restartData));
		await submit('BYL_TELEGRAM_ALLOWED_IDS', '0');
		const question = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'Jetzt neu starten?' })
		);
		expect(within(question).getByRole('button', { name: 'Jetzt neu starten' })).toBeTruthy();
		// The warning of the page System about input in other tabs, the same words.
		expect(within(question).getByText(RESTART_TEXTS.unsaved)).toBeTruthy();
		await fireEvent.click(within(question).getByRole('button', { name: 'Später' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Jetzt neu starten?' })).toBeNull();
		expect(restartData.act).not.toHaveBeenCalled();
		expect(store.restartNeeded).toBe(true);

		// The hint of the page stands; after a reload (a new store) the server still names it.
		const reloaded = credentialsStoreOf(data);
		await reloaded.refreshNotice();
		render(CredentialRestartNotice, {
			props: { store: reloaded, restart: restartStoreOf(), place: 'test' }
		});
		await tick();
		expect(screen.getAllByText(CREDENTIAL_TEXTS.pendingRestart)).toHaveLength(1);
		// After the restart the server has no mark any more: the hint goes by itself.
		data.restarted();
		await reloaded.refreshNotice();
		await tick();
		expect(screen.queryByText(CREDENTIAL_TEXTS.pendingRestart)).toBeNull();
	});

	it('"Jetzt neu starten" runs the restart of the page System and asks the server again afterwards', async () => {
		const data = fakeCredentialsData([
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS', { set: false })
		]);
		const restartData = fakeRestartData();
		await renderBlock(data, restartStoreOf(restartData));
		await submit('BYL_TELEGRAM_ALLOWED_IDS', '0');
		const question = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'Jetzt neu starten?' })
		);
		data.notice.mockResolvedValue(okAnswer(false));
		await fireEvent.click(within(question).getByRole('button', { name: 'Jetzt neu starten' }));
		await vi.waitFor(() =>
			expect(restartData.act).toHaveBeenCalledWith('restart', expect.anything())
		);
		await vi.waitFor(() =>
			expect(screen.getByText(/^becauseyoulovejira wurde neu gestartet\./)).toBeTruthy()
		);
		await vi.waitFor(() => expect(data.notice).toHaveBeenCalled());
	});
});

describe('only at the PC (V5)', () => {
	it('disables the actions on another device and says "Nur am PC möglich", also instead of the state', async () => {
		await useContext(REMOTE_CONTEXT);
		const data = fakeCredentialsData();
		const store = credentialsStoreOf(data);
		render(CredentialsBlock, {
			props: { id: 'zugang', connection: BOT, store, restart: restartStoreOf() }
		});
		await tick();
		for (const name of ['BYL_TELEGRAM_TOKEN', 'BYL_TELEGRAM_ALLOWED_IDS']) {
			const group = field(name);
			expect(within(group).getAllByText(PC_ONLY).length).toBeGreaterThan(0);
			for (const label of ['Setzen …', 'Entfernen …']) {
				const button = within(group).getByRole('button', { name: label });
				expect(button.getAttribute('aria-disabled'), label).toBe('true');
				await fireEvent.click(button);
			}
			expect(within(group).queryByLabelText(`Neuer Wert für ${name}`)).toBeNull();
			expect(
				within(group).getByText(
					/Nur am PC möglich: im Browser auf dem PC über http:\/\/127\.0\.0\.1:8090 öffnen\./
				)
			).toBeTruthy();
		}
		expect(screen.queryByRole('dialog')).toBeNull();
		// No script on another device, and the state is not even asked for.
		expect(document.body.textContent).not.toMatch(/setx|neu-starten\.bat/);
		expect(data.status).not.toHaveBeenCalled();
		expect(data.set).not.toHaveBeenCalled();
	});

	it('lets another account do nothing either', async () => {
		await useContext(MEMBER_CONTEXT);
		render(CredentialsBlock, {
			props: { id: 'zugang', connection: BOT, store: credentialsStoreOf() }
		});
		await tick();
		const button = within(field('BYL_TELEGRAM_TOKEN')).getByRole('button', { name: 'Setzen …' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
	});
});

describe('no value in the browser (S6, S7)', () => {
	it('keeps nothing without a connection: a clear message, no outbox, no storage, an empty field', async () => {
		const databases = { open: vi.fn(), databases: vi.fn(async () => []), deleteDatabase: vi.fn() };
		vi.stubGlobal('indexedDB', databases);
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const data = fakeCredentialsData([
			variableOf('BYL_TELEGRAM_TOKEN'),
			variableOf('BYL_TELEGRAM_ALLOWED_IDS')
		]);
		data.set.mockRejectedValue(new DataError('network', { status: 0 }));
		await renderBlock(data);
		const input = await submit('BYL_TELEGRAM_TOKEN', MARKER);
		await vi.waitFor(() => expect(screen.getByText(CREDENTIAL_TEXTS.offline)).toBeTruthy());
		expect(data.set).toHaveBeenCalledTimes(1);
		expect(input.value).toBe('');
		// Nothing went into the outbox (IndexedDB byl-offline) or any storage of the browser.
		expect(databases.open).not.toHaveBeenCalled();
		expect(databases.deleteDatabase).not.toHaveBeenCalled();
		expect(setItem.mock.calls.flat().join(' ')).not.toContain(MARKER);
		for (const storage of [localStorage, sessionStorage]) {
			for (let index = 0; index < storage.length; index += 1) {
				expect(storage.getItem(storage.key(index) ?? '') ?? '').not.toContain(MARKER);
			}
		}
		expect(window.location.href).not.toContain(MARKER);
		expect(document.body.textContent).not.toContain(MARKER);
		// No retry later: the value is gone from the app.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(data.set).toHaveBeenCalledTimes(1);
	});

	it('reaches the server only through its own data layer, never through the outbox or a storage', () => {
		const root = join(import.meta.dirname, '..', '..');
		for (const file of [
			'components/channels/CredentialField.svelte',
			'components/channels/CredentialsBlock.svelte',
			'components/channels/CredentialRestartNotice.svelte',
			'stores/credentials.svelte.ts',
			'data/credentials.ts',
			'domain/credentials.ts'
		]) {
			const source = readFileSync(join(root, file), 'utf8');
			expect(source, file).not.toMatch(/from '\$lib\/offline|from '\.\.\/offline|outbox-storage/);
			expect(source, file).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
		}
	});
});
