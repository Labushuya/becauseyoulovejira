// Component tests of the restart in place in the setup assistants (BW-1, ADR-0072): "Jetzt neu
// starten" in the step with the question, the state while the server is gone and the check after
// it; the files of the folder app only folded under „Notfall“; who does what where without the
// right (another device, another account, a server that is not Windows); the restart of the mail
// helper at "Hilfsprozess prüfen" and at "Chat freigeben" of Telegram; failures as entries for
// "Details" in the list of the session (FP-1). The data layers are fakes; the stores, the stepper,
// the modal and the building blocks are real.

import type PocketBase from 'pocketbase';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError, noteRequest } from '$lib/data/errors';
import { runSystemAction } from '$lib/data/system';
import type { AppContext } from '$lib/domain/context';
import type { Connection, SecretStatus } from '$lib/domain/connections';
import { parseSetupResume, setupResumeKey } from '$lib/domain/setup-resume';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { RestartStore } from '$lib/stores/restart.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import {
	connectionOf,
	connectionsStoreOf,
	fakeConnectionsData,
	type FakeConnectionsData
} from '$lib/test/connections-fake';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import {
	fakeRestartClock,
	fakeRestartData,
	ok,
	restartOverview,
	restartStoreOf,
	type FakeRestartData
} from '$lib/test/restart-fake';

useOverlayStubs();

const ID = 'conn00000000002';
const MAIL_ID = 'conn00000000003';
const HINT = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';
const PC_ONLY =
	'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen).';
const LINUX_CONTEXT: AppContext = { ...PC_CONTEXT, platform: 'linux', scripts: false };

function bot(overrides: Partial<Connection> = {}): Connection {
	return connectionOf({
		id: ID,
		type: 'telegram',
		label: 'Telegram-Bot',
		secretEnv: 'BYL_TELEGRAM_TOKEN',
		allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
		...overrides
	});
}

function mailbox(overrides: Partial<Connection> = {}): Connection {
	return connectionOf({
		id: MAIL_ID,
		type: 'mail',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		mailProvider: 'webde',
		mailUser: 'anna@example.com',
		keywords: ['todo'],
		...overrides
	});
}

async function open(
	item: Connection,
	status: SecretStatus,
	options: { restart?: RestartStore; data?: FakeConnectionsData } = {}
) {
	const data = options.data ?? fakeConnectionsData([item], status).data;
	const connections = await connectionsStoreOf(data);
	const restart = options.restart ?? restartStoreOf();
	const kind = item.type === 'mail' ? 'webde' : 'telegram';
	render(ChannelsViewHarness, {
		props: { connections, restart, setup: { kind, connectionId: item.id }, onchange: vi.fn() }
	});
	await tick();
	await tick();
	const name = item.type === 'mail' ? 'Web.de einrichten' : 'Telegram-Bot einrichten';
	return { data, connections, restart, dialog: screen.getByRole('dialog', { name }) };
}

const heading = (dialog: HTMLElement) =>
	within(dialog).getByRole('heading', { level: 3, name: /^Schritt \d von 7/ });

/** The step without its folded emergency way. */
function textOutsideEmergency(dialog: HTMLElement): string {
	const step = heading(dialog).closest('section') as HTMLElement;
	const copy = step.cloneNode(true) as HTMLElement;
	for (const details of copy.querySelectorAll('details')) details.remove();
	return copy.textContent ?? '';
}

/** A client of the SDK whose every request fails like the SDK with 502 "script". */
function failingClient(): PocketBase {
	return {
		send: vi.fn(async (path: string, options: { method: string }) => {
			const error = {
				status: 502,
				url: `http://127.0.0.1:8090${path}`,
				isAbort: false,
				response: { reason: 'script', message: 'Das Steuerskript hat abgebrochen.' }
			};
			noteRequest(error, options.method, path);
			throw error;
		})
	} as unknown as PocketBase;
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

describe('restart in the step (the administrator at the PC)', () => {
	it('offers „Jetzt neu starten“ and folds the files of the folder app under „Notfall“', async () => {
		const { dialog } = await open(bot(), { secret: true, allowlist: false });
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 7: App neu starten/);
		expect(within(dialog).getByRole('button', { name: 'Jetzt neu starten' })).toBeTruthy();
		expect(within(dialog).getByText(/„Jetzt neu starten“ startet sie geordnet neu/)).toBeTruthy();

		const summary = within(dialog).getByText('Notfall: Neustart über den Ordner app');
		const emergency = summary.parentElement as HTMLDetailsElement;
		expect(emergency.tagName).toBe('DETAILS');
		expect(emergency.open).toBe(false);
		expect(emergency.textContent).toMatch(/neu-starten\.bat/);
		expect(emergency.textContent).toMatch(/start\.bat im Ordner app/);
		expect(
			within(emergency).getByRole('region', { name: 'Diese Datei doppelklicken' }).textContent
		).toBe('app\\neu-starten.bat');
		// Outside the fold the step names no script.
		expect(textOutsideEmergency(dialog)).not.toMatch(/\.bat\b|\.ps1\b/);

		// "Alle Schritte anzeigen" folds the file as well.
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Alle Schritte anzeigen' }));
		const overview = within(dialog).getByRole('heading', { name: /: App neu starten$/ })
			.parentElement as HTMLElement;
		expect(within(overview).getByText('Notfall: Neustart über den Ordner app')).toBeTruthy();
		const copy = overview.cloneNode(true) as HTMLElement;
		for (const details of copy.querySelectorAll('details')) details.remove();
		expect(copy.textContent).not.toMatch(/\.bat\b/);
	});

	it('asks, says what happens while the server is gone, waits for it and checks again', async () => {
		const restartData = fakeRestartData();
		let release: () => void = () => undefined;
		restartData.act.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve(ok('restarting' as const));
				})
		);
		const { dialog, data } = await open(
			bot(),
			{ secret: true, allowlist: false },
			{ restart: restartStoreOf(restartData) }
		);
		const asked = data.secretStatus.mock.calls.length;

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
		const question = within(dialog).getByRole('group', {
			name: 'becauseyoulovejira jetzt neu starten?'
		});
		expect(within(question).getByText(/Eingaben in anderen Tabs/)).toBeTruthy();
		expect(within(question).getByText(/steht danach wieder hier/)).toBeTruthy();
		expect(restartData.act).not.toHaveBeenCalled();
		await fireEvent.click(within(question).getByRole('button', { name: 'Neu starten' }));

		await vi.waitFor(() =>
			expect(restartData.act).toHaveBeenCalledWith('restart', expect.anything())
		);
		expect(within(dialog).getByRole('heading', { name: /Neustart läuft …/ })).toBeTruthy();
		expect(
			within(dialog).getByRole('button', { name: 'Jetzt neu starten' }).getAttribute('aria-busy')
		).toBe('true');
		// The step a restart started from is kept exactly, for a reload during or after it.
		expect(
			parseSetupResume(sessionStorage.getItem(setupResumeKey('telegram', ID)), Date.now())
		).toMatchObject({ step: 4, restart: true, connect: null });

		data.secretStatus.mockResolvedValue({ secret: true, allowlist: true });
		release();
		await vi.waitFor(() =>
			expect(within(dialog).getByText(/^becauseyoulovejira wurde neu gestartet\./)).toBeTruthy()
		);
		await vi.waitFor(() => expect(data.secretStatus.mock.calls.length).toBeGreaterThan(asked));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText('Die App sieht BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS.')
			).toBeTruthy()
		);
		// The step stays while the facts move on.
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 7/);
		expect(restartData.health).toHaveBeenCalled();
	});

	it('keeps the restart when the question is cancelled', async () => {
		const restartData = fakeRestartData();
		const { dialog } = await open(
			bot(),
			{ secret: true, allowlist: false },
			{ restart: restartStoreOf(restartData) }
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
		const question = within(dialog).getByRole('group', {
			name: 'becauseyoulovejira jetzt neu starten?'
		});
		await fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }));
		expect(within(dialog).queryByRole('group', { name: /jetzt neu starten\?/ })).toBeNull();
		expect(restartData.status).not.toHaveBeenCalled();
	});

	it('shows a refusal of the script as an error with „Details“ in the list of the session', async () => {
		const restart = new RestartStore(
			{
				status: async () => ok(restartOverview()),
				act: (action, options) => runSystemAction(failingClient(), action, options),
				health: async () => true
			},
			{ ensureValid: () => true, logout: vi.fn() },
			fakeRestartClock()
		);
		const { dialog } = await open(bot(), { secret: true, allowlist: false }, { restart });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(
			within(within(dialog).getByRole('group', { name: /jetzt neu starten\?/ })).getByRole(
				'button',
				{ name: 'Neu starten' }
			)
		);
		await vi.waitFor(() =>
			expect(
				within(dialog).getByRole('heading', {
					name: /Das Steuerskript hat nicht wie erwartet geantwortet/
				})
			).toBeTruthy()
		);
		const details = within(dialog).getByRole('button', { name: 'Details: App neu starten' });
		await fireEvent.click(details);
		expect(within(dialog).getByText('HTTP 502 (Server nicht erreichbar)')).toBeTruthy();
		expect(within(dialog).getByText('POST /api/byl/system/actions/restart')).toBeTruthy();
		expect(problemLog.entries.map((entry) => entry.intent)).toContain('App neu starten');
		// The text of the page System names status.bat; here only „Notfall“ does.
		expect(textOutsideEmergency(dialog)).not.toMatch(/\.bat\b/);
	});

	it('gives a failed check of the variables its „Details“', async () => {
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: false });
		const { dialog } = await open(bot(), { secret: true, allowlist: false }, { data });
		data.secretStatus.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erneut prüfen' }));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByRole('button', { name: 'Details: Zugangsdaten des Kanals prüfen' })
			).toBeTruthy()
		);
		expect(within(dialog).getByText(/Der Server hat mit einem Fehler geantwortet/)).toBeTruthy();
	});

	it('offers the restart again at „Chat freigeben“ of Telegram after the chat ID', async () => {
		const { data } = fakeConnectionsData([bot()], { secret: true, allowlist: true });
		data.get.mockResolvedValue(
			bot({
				lastRunAt: '2026-10-19 10:00:00.000Z',
				lastHint: HINT,
				updated: '2026-10-19 10:00:00.000Z'
			})
		);
		const { dialog } = await open(bot(), { secret: true, allowlist: true }, { data });
		expect(heading(dialog).textContent).toMatch(/^Schritt 6 von 7: Deinen Chat freigeben/);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt abrufen' }));
		await vi.waitFor(() =>
			expect(within(dialog).getByRole('heading', { name: /Erkannte Chat-ID: 424242/ })).toBeTruthy()
		);
		expect(within(dialog).getByText(/dann unten „Jetzt neu starten“/)).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Jetzt neu starten' })).toBeTruthy();
		expect(textOutsideEmergency(dialog)).not.toMatch(/\.bat\b/);
	});
});

describe('restart of the mail helper at „Hilfsprozess prüfen“', () => {
	it('offers „Mail-Helfer neu starten“ and checks the helper again afterwards', async () => {
		const { data } = fakeConnectionsData([mailbox()], { secret: true, allowlist: null });
		const restartData: FakeRestartData = fakeRestartData();
		const { dialog } = await open(
			mailbox(),
			{ secret: true, allowlist: null },
			{ data, restart: restartStoreOf(restartData) }
		);
		expect(heading(dialog).textContent).toMatch(/^Schritt 7 von 7: Auf den ersten Abruf warten/);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hilfsprozess prüfen' }));
		const button = await vi.waitFor(() =>
			within(dialog).getByRole('button', { name: 'Mail-Helfer neu starten' })
		);
		data.listMailbox.mockResolvedValueOnce({ kind: 'ok', value: [] });
		await fireEvent.click(button);
		await vi.waitFor(() =>
			expect(restartData.act).toHaveBeenCalledWith('mail-restart', expect.anything())
		);
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText('Der Mail-Hilfsprozess läuft und erreicht dein Postfach.')
			).toBeTruthy()
		);
		expect(data.listMailbox).toHaveBeenCalledTimes(2);
		expect(textOutsideEmergency(dialog)).not.toMatch(/\.bat\b/);
	});

	it('gives a failed check of the helper its „Details“', async () => {
		const { data } = fakeConnectionsData([mailbox()], { secret: true, allowlist: null });
		data.listMailbox.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		const { dialog } = await open(mailbox(), { secret: true, allowlist: null }, { data });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hilfsprozess prüfen' }));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByRole('button', { name: 'Details: Mail-Helfer prüfen' })
			).toBeTruthy()
		);
	});

	it('gives keywords that could not be saved their „Details“', async () => {
		const { data } = fakeConnectionsData([mailbox({ keywords: [] })], {
			secret: true,
			allowlist: null
		});
		data.saveSettings.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		const { dialog } = await open(
			mailbox({ keywords: [] }),
			{ secret: true, allowlist: null },
			{ data }
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: /Verbinden, erledigt/ }));
		await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Neues Stichwort' }), {
			target: { value: 'todo' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByRole('button', { name: 'Details: Einstellungen des Kanals speichern' })
			).toBeTruthy()
		);
	});
});

describe('without the right to restart', () => {
	it('says on another device to restart at the PC, without a button and without a script', async () => {
		await useContext(REMOTE_CONTEXT);
		const { dialog } = await open(bot(), { secret: true, allowlist: false });
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 7: App neu starten/);
		expect(within(dialog).queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		expect(within(dialog).getByText(PC_ONLY)).toBeTruthy();
		expect(within(dialog).getByText(/„Einstellungen → System“/)).toBeTruthy();
		expect(dialog.textContent).not.toMatch(/\.bat\b|\.ps1\b|Notfall/);
	});

	it('names the administrator for another account', async () => {
		await useContext(MEMBER_CONTEXT);
		const { dialog } = await open(bot(), { secret: true, allowlist: false });
		expect(within(dialog).queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		expect(
			within(dialog).getByText(/^Neu starten darf nur der Verwalter der App, und nur direkt am PC/)
		).toBeTruthy();
		expect(within(dialog).getByText(/^Bitte den Verwalter darum\./)).toBeTruthy();
		expect(dialog.textContent).not.toMatch(/\.bat\b|\.ps1\b/);
	});

	it('says that a server that is not Windows restarts as it is set up', async () => {
		await useContext(LINUX_CONTEXT);
		const { data } = fakeConnectionsData([mailbox()], { secret: true, allowlist: null });
		const { dialog } = await open(mailbox(), { secret: true, allowlist: null }, { data });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hilfsprozess prüfen' }));
		await vi.waitFor(() =>
			expect(within(dialog).getByText('Auf diesem Server nicht verfügbar.')).toBeTruthy()
		);
		expect(within(dialog).queryByRole('button', { name: 'Mail-Helfer neu starten' })).toBeNull();
		expect(dialog.textContent).not.toMatch(/Notfall/);
	});
});
