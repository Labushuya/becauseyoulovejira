// Component tests of the return to the step of a setup assistant (BW-1, ADR-0072): after a restart
// and a reload (the component goes and comes again on the same sessionStorage) the assistant stands
// exactly at the step the restart started from, with the hint that values of "Wert hier einsetzen"
// are not kept; the inputs of "Verbinden" of a new setup come back, under `byl-setup:neu:<art>`,
// and move to the connection once it is created; "Später fortsetzen" keeps the entry, "Fertig" and ×
// drop it; a broken or expired entry goes without breaking anything; and no assistant with access
// data ever writes a secret into sessionStorage or localStorage.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupKind, SetupTarget } from '$lib/domain/channel-setup';
import type { Connection } from '$lib/domain/connections';
import {
	SECRET_NOT_KEPT,
	SETUP_RESUME_TTL_MS,
	parseSetupResume,
	serializeSetupResume,
	setupResumeKey
} from '$lib/domain/setup-resume';
import { problemLog } from '$lib/stores/problem-log.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import {
	connectionOf,
	connectionsStoreOf,
	fakeConnectionsData,
	type FakeConnectionsData
} from '$lib/test/connections-fake';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { restartStoreOf } from '$lib/test/restart-fake';

useOverlayStubs();

const ID = 'conn00000000002';
const NEW_ID = 'conn00000000009';
const SECRET = 'Geheim-Wert-4711';
const TOKEN_LABEL = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

const TITLES: Readonly<Partial<Record<SetupKind, string>>> = {
	kalender: 'Google Calendar einrichten',
	telegram: 'Telegram-Bot einrichten',
	webde: 'Web.de einrichten',
	gmail: 'Gmail einrichten',
	notion: 'Notion einrichten',
	github: 'GitHub einrichten'
};

function bot(): Connection {
	return connectionOf({
		id: ID,
		type: 'telegram',
		label: 'Telegram-Bot',
		secretEnv: 'BYL_TELEGRAM_TOKEN',
		allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
	});
}

async function open(setup: SetupTarget, data: FakeConnectionsData) {
	const connections = await connectionsStoreOf(data);
	const onchange = vi.fn();
	render(ChannelsViewHarness, {
		props: { connections, restart: restartStoreOf(), setup, onchange }
	});
	await tick();
	await tick();
	return { onchange, dialog: screen.getByRole('dialog', { name: TITLES[setup.kind] }) };
}

/** The tab loads the page again: the component goes and comes back on the same storage. */
async function reload(setup: SetupTarget, data: FakeConnectionsData) {
	cleanup();
	return open(setup, data);
}

const heading = (dialog: HTMLElement) =>
	within(dialog).getByRole('heading', { level: 3, name: /^Schritt \d von \d/ });

/** Every value in web storage of this tab and this device. */
function stored(): string {
	return [sessionStorage, localStorage]
		.flatMap((storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`))
		.join('\n');
}

/** Types `value` into the folded "Wert hier einsetzen" of the step. */
async function typeValue(dialog: HTMLElement, value: string) {
	const details = within(dialog).getByText('Wert hier einsetzen (bleibt in diesem Browserfenster)')
		.parentElement as HTMLDetailsElement;
	details.open = true;
	await fireEvent(details, new Event('toggle'));
	const field = details.querySelector('input') as HTMLInputElement;
	await fireEvent.input(field, { target: { value } });
	expect(field.value).toBe(value);
}

beforeEach(async () => {
	sessionStorage.clear();
	localStorage.clear();
	problemLog.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('back at the step after a restart and a reload', () => {
	it('opens exactly at the step of the restart, though the facts moved on, and says the value is gone', async () => {
		const setup = { kind: 'telegram' as const, connectionId: ID };
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: false });
		const first = await open(setup, data);
		expect(heading(first.dialog).textContent).toMatch(/^Schritt 5 von 7: App neu starten/);
		await fireEvent.click(within(first.dialog).getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(
			within(within(first.dialog).getByRole('group', { name: /jetzt neu starten\?/ })).getByRole(
				'button',
				{ name: 'Neu starten' }
			)
		);
		await vi.waitFor(() =>
			expect(
				within(first.dialog).getByText(/^becauseyoulovejira wurde neu gestartet\./)
			).toBeTruthy()
		);

		// After the restart the app sees both variables: the facts would open "Chat freigeben".
		data.secretStatus.mockResolvedValue({ secret: true, allowlist: true });
		const again = await reload(setup, data);
		expect(heading(again.dialog).textContent).toMatch(/^Schritt 5 von 7: App neu starten/);
		await vi.waitFor(() =>
			expect(
				within(again.dialog).getByText(
					'Die App sieht BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS.'
				)
			).toBeTruthy()
		);

		await fireEvent.click(within(again.dialog).getByRole('button', { name: /Token setzen/ }));
		expect(within(again.dialog).getByText(SECRET_NOT_KEPT)).toBeTruthy();
	});

	it('keeps the inputs of „Verbinden“ of a new setup and brings them back after a reload', async () => {
		const setup = { kind: 'github' as const, connectionId: null };
		const { data } = fakeConnectionsData([]);
		const first = await open(setup, data);
		await fireEvent.click(within(first.dialog).getByRole('button', { name: /Repositorys, offen/ }));
		expect(heading(first.dialog).textContent).toMatch(/^Schritt 4 von 6: Repositorys hinzufügen/);
		await fireEvent.input(within(first.dialog).getByLabelText('Bezeichnung (Pflichtfeld)'), {
			target: { value: 'Meine Roadmaps' }
		});
		await fireEvent.input(within(first.dialog).getByLabelText('Repository (Pflichtfeld)'), {
			target: { value: 'beispiel/roadmap' }
		});
		await fireEvent.click(
			within(first.dialog).getByRole('checkbox', { name: /Alle meine Repositorys beobachten/ })
		);
		const entry = parseSetupResume(sessionStorage.getItem('byl-setup:neu:github'), Date.now());
		expect(entry).toMatchObject({
			step: 3,
			connect: { label: 'Meine Roadmaps', githubAuto: true, repo: { input: 'beispiel/roadmap' } }
		});

		const again = await reload(setup, data);
		expect(heading(again.dialog).textContent).toMatch(/^Schritt 4 von 6: Repositorys hinzufügen/);
		expect(within(again.dialog).getByLabelText('Bezeichnung (Pflichtfeld)')).toHaveProperty(
			'value',
			'Meine Roadmaps'
		);
		expect(within(again.dialog).getByLabelText('Oder ein Repository eintippen')).toHaveProperty(
			'value',
			'beispiel/roadmap'
		);
		expect(
			within(again.dialog).getByRole('checkbox', { name: /Alle meine Repositorys beobachten/ })
		).toHaveProperty('checked', true);
	});

	it('moves the entry to the new connection once it is created', async () => {
		const setup = { kind: 'kalender' as const, connectionId: null };
		const { data } = fakeConnectionsData([]);
		const { dialog, onchange } = await open(setup, data);
		await fireEvent.input(within(dialog).getByLabelText(/Bezeichnung/), {
			target: { value: 'Familie' }
		});
		expect(sessionStorage.getItem(setupResumeKey('kalender', null))).not.toBeNull();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({ kind: 'kalender', connectionId: NEW_ID })
		);
		expect(sessionStorage.getItem(setupResumeKey('kalender', null))).toBeNull();
		expect(
			parseSetupResume(sessionStorage.getItem(setupResumeKey('kalender', NEW_ID)), Date.now())
		).toMatchObject({ step: 0, connect: null });
	});
});

describe('tidying up', () => {
	it('keeps the entry on „Später fortsetzen“ and drops it on „Fertig“ and on ×', async () => {
		const setup = { kind: 'telegram' as const, connectionId: ID };
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: false });
		const key = setupResumeKey('telegram', ID);

		let view = await open(setup, data);
		await fireEvent.click(within(view.dialog).getByRole('button', { name: 'Später fortsetzen' }));
		expect(parseSetupResume(sessionStorage.getItem(key), Date.now())).toMatchObject({ step: 4 });

		view = await reload(setup, data);
		await fireEvent.click(within(view.dialog).getByRole('button', { name: 'Schließen' }));
		expect(sessionStorage.getItem(key)).toBeNull();

		view = await reload(setup, data);
		await fireEvent.click(within(view.dialog).getByRole('button', { name: /Test, offen/ }));
		expect(sessionStorage.getItem(key)).not.toBeNull();
		await fireEvent.click(within(view.dialog).getByRole('button', { name: 'Fertig' }));
		expect(sessionStorage.getItem(key)).toBeNull();
	});

	it.each([
		['broken', '{"v":1,"step":'],
		['of another form', JSON.stringify({ v: 1, step: 'fünf', savedAt: Date.now() })],
		[
			'expired',
			serializeSetupResume({
				step: 6,
				savedAt: Date.now() - SETUP_RESUME_TTL_MS - 1000,
				restart: true,
				connect: null
			})
		]
	])('drops a %s entry without breaking and opens from the facts', async (_name, value) => {
		const key = setupResumeKey('telegram', ID);
		sessionStorage.setItem(key, value);
		sessionStorage.setItem('byl-setup:neu:notion', value);
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: false });
		const { dialog } = await open({ kind: 'telegram', connectionId: ID }, data);
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 7: App neu starten/);
		expect(sessionStorage.getItem(key)).toBeNull();
		// Stale entries of other assistants of the tab go as well.
		expect(sessionStorage.getItem('byl-setup:neu:notion')).toBeNull();
	});
});

describe('no secret in web storage', () => {
	it.each([
		['kalender', /Variable setzen, offen/],
		['telegram', /Token setzen, offen/],
		['webde', /Variable setzen, offen/],
		['gmail', /Variable setzen, offen/],
		['notion', /Token setzen, offen/],
		['github', /Token setzen, offen/]
	] as const)(
		'%s keeps neither the value of „Wert hier einsetzen“ nor a token typed into a field',
		async (kind, variableStep) => {
			const setup = { kind, connectionId: null };
			const { data } = fakeConnectionsData([]);
			const { dialog } = await open(setup, data);
			await fireEvent.click(within(dialog).getByRole('button', { name: variableStep }));
			await typeValue(dialog, SECRET);

			// A token in the name of the connection, by mistake; it is left out as well.
			await fireEvent.click(
				within(dialog).getByRole('button', { name: /: (Verbinden|Repositorys),/ })
			);
			await fireEvent.input(within(dialog).getByLabelText('Bezeichnung (Pflichtfeld)'), {
				target: { value: TOKEN_LABEL }
			});
			await fireEvent.click(within(dialog).getByRole('button', { name: /: Neu starten,/ }));
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Später fortsetzen' }));

			const all = stored();
			expect(all).toMatch(/byl-setup:neu:/);
			expect(all).not.toContain(SECRET);
			expect(all).not.toContain(TOKEN_LABEL);
		}
	);

	it('keeps no secret through a restart of an assistant with a connection', async () => {
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: false });
		const { dialog } = await open({ kind: 'telegram', connectionId: ID }, data);
		await fireEvent.click(within(dialog).getByRole('button', { name: /Token setzen/ }));
		await typeValue(dialog, SECRET);
		await fireEvent.click(within(dialog).getByRole('button', { name: /Neu starten/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(
			within(within(dialog).getByRole('group', { name: /jetzt neu starten\?/ })).getByRole(
				'button',
				{ name: 'Neu starten' }
			)
		);
		await vi.waitFor(() =>
			expect(within(dialog).getByText(/^becauseyoulovejira wurde neu gestartet\./)).toBeTruthy()
		);
		expect(stored()).toMatch(/"restart":true/);
		expect(stored()).not.toContain(SECRET);
		expect(JSON.stringify(data.secretStatus.mock.calls)).not.toContain(SECRET);
	});
});
