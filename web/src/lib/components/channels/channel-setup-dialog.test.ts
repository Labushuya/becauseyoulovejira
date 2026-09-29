// Component tests of the setup assistant (ADR-0026 sections 4 and 5, plan EH-5 §3.7/§3.8/§3.13) on
// the page "Kanäle": opening through the address, closing removes it, creating writes the new
// connection into it, the first step comes from the facts of the server, "Weiter" is never locked
// and an open check is named later, the tabs of the variable remember the way, the restart step
// asks the server again, the first run shows its result in the step, realtime updates the check
// and ends with the modal, "Alle Schritte anzeigen", and the typed value never leaves the window.
// The data layer is a fake; the store, the stepper and the modal are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordChange } from '$lib/data/realtime';
import { SETX_WAY_KEY, setupStepKey, type SetupTarget } from '$lib/domain/channel-setup';
import type { Connection, SecretStatus } from '$lib/domain/connections';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000001';
const NEW_ID = 'conn00000000009';
const SECRET = 'https://calendar.google.com/calendar/ical/geheim-4711/basic.ics';

function calendar(overrides: Partial<Connection> = {}): Connection {
	return {
		id: ID,
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: [],
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-09-26 08:00:00.000Z',
		updated: '2026-09-26 08:00:00.000Z',
		...overrides
	};
}

function fakes(items: Connection[], status: SecretStatus = { secret: false, allowlist: null }) {
	const listeners: ((change: RecordChange<Connection>) => void)[] = [];
	const unsubscribe = vi.fn(async () => undefined);
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => items),
		create: vi.fn<ConnectionsData['create']>(async (draft) =>
			calendar({ id: NEW_ID, label: draft.label, secretEnv: draft.secretEnv })
		),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(async (current, settings) => ({
			...current,
			keywords: settings.keywords
		})),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => status),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 3,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 2,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(async (id) => ({
			...(items.find((item) => item.id === id) ?? calendar()),
			lastRunAt: '2026-09-26 10:00:00.000Z',
			lastOkAt: '2026-09-26 10:00:00.000Z',
			updated: '2026-09-26 10:00:00.000Z'
		})),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async (_id, onChange) => {
			listeners.push(onChange);
			return unsubscribe;
		}),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(async () => ({
			state: 'running' as const,
			version: '0.5.0',
			message: ''
		})),
		scan: vi.fn<ConnectionsData['scan']>(async () => ({ status: 'started' as const, message: '' }))
	} satisfies ConnectionsData;
	const flags = new FlagStore();
	const store = new ConnectionsStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	return { data, store, flags, listeners, unsubscribe };
}

async function open(
	items: Connection[],
	setup: SetupTarget,
	status?: SecretStatus
): Promise<ReturnType<typeof fakes> & { onchange: ReturnType<typeof vi.fn> }> {
	const context = fakes(items, status);
	await context.store.load();
	const onchange = vi.fn();
	render(ChannelsViewHarness, { props: { connections: context.store, setup, onchange } });
	await tick();
	await tick();
	return { ...context, onchange };
}

const dialog = () => within(screen.getByRole('dialog', { name: 'Google Calendar einrichten' }));
const stepHeading = () => dialog().getByRole('heading', { level: 3, name: /^Schritt \d von 6/ });

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('setup assistant: frame and address', () => {
	it('opens from ?einrichten=kalender as modal L with the stepper and the first step', async () => {
		await open([], { kind: 'kalender', connectionId: null });

		const box = screen.getByRole('dialog', { name: 'Google Calendar einrichten' });
		expect(box.classList.contains('size-l')).toBe(true);
		expect(dialog().getByRole('navigation', { name: 'Schritte der Einrichtung' })).toBeTruthy();
		expect(stepHeading().textContent?.trim()).toBe('Schritt 1 von 6: Verbindung anlegen');
		expect(
			dialog()
				.getByRole('button', { name: /Verbinden, aktuell/ })
				.getAttribute('aria-current')
		).toBe('step');
		expect(dialog().queryByRole('button', { name: 'Zurück' })).toBeNull();
		expect(dialog().getByRole('button', { name: 'Weiter' })).toBeTruthy();
	});

	it('closes with "Später fortsetzen" and removes the address', async () => {
		const { onchange } = await open([], { kind: 'kalender', connectionId: null });

		await fireEvent.click(dialog().getByRole('button', { name: 'Später fortsetzen' }));
		expect(onchange).toHaveBeenLastCalledWith(null);
		await tick();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('creates the connection and writes its ID into the address', async () => {
		const { onchange, data } = await open([], { kind: 'kalender', connectionId: null });

		expect(dialog().getByLabelText(/Bezeichnung/)).toHaveProperty('value', 'Google Calendar');
		expect(dialog().getByLabelText(/Name der Variablen für die iCal-Adresse/)).toHaveProperty(
			'value',
			'BYL_GOOGLE_CALENDAR_URL'
		);
		await fireEvent.click(dialog().getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({ kind: 'kalender', connectionId: NEW_ID })
		);
		expect(data.create).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'calendar', secretEnv: 'BYL_GOOGLE_CALENDAR_URL' })
		);
		await vi.waitFor(() =>
			expect(dialog().getByText('Verbindung „Google Calendar“ angelegt.')).toBeTruthy()
		);
		// Still the first step: the assistant does not jump under the pointer.
		expect(stepHeading().textContent).toMatch(/^Schritt 1 von 6/);
	});

	it('says when the connection of the address is gone', async () => {
		await open([], { kind: 'kalender', connectionId: ID });
		expect(dialog().getByText(/Diese Verbindung gibt es nicht mehr/)).toBeTruthy();
		expect(stepHeading().textContent).toMatch(/^Schritt 1 von 6/);
	});
});

describe('setup assistant: progress from the server', () => {
	it('opens at "Adresse holen" while the app does not see the variable', async () => {
		await open([calendar()], { kind: 'kalender', connectionId: ID });
		expect(stepHeading().textContent?.trim()).toBe('Schritt 2 von 6: Geheime iCal-Adresse holen');
		const link = dialog().getByRole('link', { name: /calendar\.google\.com/ });
		expect(link.getAttribute('href')).toBe('https://calendar.google.com');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('opens at "Stichwörter" once the app sees the variable (after the restart)', async () => {
		await open(
			[calendar()],
			{ kind: 'kalender', connectionId: ID },
			{ secret: true, allowlist: null }
		);
		expect(stepHeading().textContent?.trim()).toBe('Schritt 5 von 6: Stichwörter festlegen');
	});

	it('opens at a later step looked at in this tab, but never before the facts', async () => {
		sessionStorage.setItem(setupStepKey(ID), '3');
		await open([calendar()], { kind: 'kalender', connectionId: ID });
		expect(stepHeading().textContent).toMatch(/^Schritt 4 von 6/);
		expect(sessionStorage.getItem(setupStepKey(ID))).toBe('3');
	});

	it('never locks "Weiter" and names an open check of an earlier step', async () => {
		await open([calendar()], { kind: 'kalender', connectionId: ID });

		for (let step = 2; step < 5; step += 1) {
			await fireEvent.click(dialog().getByRole('button', { name: 'Weiter' }));
		}
		expect(stepHeading().textContent).toMatch(/^Schritt 5 von 6/);
		expect(document.activeElement).toBe(stepHeading());
		expect(sessionStorage.getItem(setupStepKey(ID))).toBe('4');
		expect(
			dialog().getByText(
				/Schritt 4 ist noch offen: Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht\./
			)
		).toBeTruthy();
		expect(dialog().getByRole('button', { name: /Neu starten, Prüfung offen/ })).toBeTruthy();
		await fireEvent.click(dialog().getByRole('button', { name: 'Zu Schritt 4' }));
		expect(stepHeading().textContent).toMatch(/^Schritt 4 von 6: App neu starten/);
		expect(document.activeElement).toBe(stepHeading());
	});
});

describe('setup assistant: steps', () => {
	it('offers the command prompt and the control panel as tabs and remembers the way', async () => {
		await open([calendar()], { kind: 'kalender', connectionId: ID });
		await fireEvent.click(dialog().getByRole('button', { name: /Variable setzen, offen/ }));

		const tabs = dialog().getByRole('tablist', { name: 'Weg zur Variablen' });
		expect(
			within(tabs).getByRole('tab', { name: 'Eingabeaufforderung' }).getAttribute('aria-selected')
		).toBe('true');
		const command = dialog().getByRole('region', { name: 'Befehl für die Eingabeaufforderung' });
		expect(command.textContent).toBe('setx BYL_GOOGLE_CALENDAR_URL "Platzhalter: ‹iCal-Adresse›"');

		await fireEvent.click(within(tabs).getByRole('tab', { name: 'Systemsteuerung' }));
		expect(localStorage.getItem(SETX_WAY_KEY)).toBe('systemsteuerung');
		const panel = dialog().getByRole('tabpanel', { name: 'Systemsteuerung' });
		expect(panel.textContent).toMatch(/Umgebungsvariablen für dieses Konto bearbeiten/);
		expect(within(panel).getByRole('region', { name: 'Name der Variablen' }).textContent).toBe(
			'BYL_GOOGLE_CALENDAR_URL'
		);
	});

	it('asks the server again at "Neu starten" and on "Erneut prüfen"', async () => {
		const { data } = await open([calendar()], { kind: 'kalender', connectionId: ID });
		const before = data.secretStatus.mock.calls.length;
		await fireEvent.click(dialog().getByRole('button', { name: /Neu starten, offen/ }));

		await vi.waitFor(() => expect(data.secretStatus.mock.calls.length).toBe(before + 1));
		expect(dialog().getByText('Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.')).toBeTruthy();
		expect(dialog().getByText(/Hast du setx schon ausgeführt\?/)).toBeTruthy();
		expect(dialog().getByRole('region', { name: 'Diese Datei doppelklicken' }).textContent).toBe(
			'app\\neu-starten.bat'
		);

		data.secretStatus.mockResolvedValue({ secret: true, allowlist: null });
		await fireEvent.click(dialog().getByRole('button', { name: 'Erneut prüfen' }));
		await vi.waitFor(() =>
			expect(dialog().getByText('Die App sieht BYL_GOOGLE_CALENDAR_URL.')).toBeTruthy()
		);
		// The step stays while the fact changes.
		expect(stepHeading().textContent).toMatch(/^Schritt 4 von 6/);
	});

	it('saves keywords at once in the step', async () => {
		const { data } = await open(
			[calendar()],
			{ kind: 'kalender', connectionId: ID },
			{ secret: true, allowlist: null }
		);
		const field = dialog().getByRole('textbox', { name: 'Neues Stichwort' });
		await fireEvent.input(field, { target: { value: 'todo' } });
		await fireEvent.click(dialog().getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() => expect(data.saveSettings).toHaveBeenCalled());
		await vi.waitFor(() => expect(dialog().getByText('1 Stichwort: todo.')).toBeTruthy());
	});

	it('runs the first fetch in the step and shows the result there, not as a flag', async () => {
		const { data, flags } = await open(
			[calendar({ keywords: ['todo'] })],
			{ kind: 'kalender', connectionId: ID },
			{ secret: true, allowlist: null }
		);
		expect(stepHeading().textContent).toMatch(/^Schritt 6 von 6: Ersten Abruf starten/);
		expect(dialog().getByRole('button', { name: 'Fertig' })).toBeTruthy();

		await fireEvent.click(dialog().getByRole('button', { name: 'Jetzt abrufen' }));
		await vi.waitFor(() => expect(data.run).toHaveBeenCalledWith(ID));
		await vi.waitFor(() =>
			expect(dialog().getByText('„Kalender“: 3 neu, 2 ohne Stichwort.')).toBeTruthy()
		);
		expect(dialog().getByText(/^Abruf erfolgreich, zuletzt/)).toBeTruthy();
		expect(flags.flags).toEqual([]);
	});

	it('follows its connection through realtime and ends the subscription on closing', async () => {
		const { data, listeners, unsubscribe, onchange } = await open(
			[calendar({ keywords: ['todo'] })],
			{ kind: 'kalender', connectionId: ID },
			{ secret: true, allowlist: null }
		);
		await vi.waitFor(() => expect(data.subscribe).toHaveBeenCalledWith(ID, expect.any(Function)));
		expect(dialog().getByText('Noch kein Abruf.')).toBeTruthy();

		for (const listener of listeners) {
			listener({
				action: 'update',
				record: calendar({
					keywords: ['todo'],
					lastRunAt: '2026-09-26 10:15:00.000Z',
					lastOkAt: '2026-09-26 10:15:00.000Z',
					updated: '2026-09-26 10:15:00.000Z'
				})
			});
		}
		await vi.waitFor(() => expect(dialog().getByText(/^Abruf erfolgreich, zuletzt/)).toBeTruthy());

		await fireEvent.click(dialog().getByRole('button', { name: 'Fertig' }));
		expect(onchange).toHaveBeenLastCalledWith(null);
		await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled());
	});

	it('shows all steps one below the other on "Alle Schritte anzeigen"', async () => {
		await open([calendar()], { kind: 'kalender', connectionId: ID });
		const toggle = dialog().getByRole('button', { name: 'Alle Schritte anzeigen' });
		expect(toggle.getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		expect(
			dialog()
				.getAllByRole('heading', { level: 3 })
				.map((heading) => heading.textContent?.trim())
		).toEqual([
			'Schritt 1 von 6: Verbindung anlegen',
			'Schritt 2 von 6: Geheime iCal-Adresse holen',
			'Schritt 3 von 6: Adresse als Windows-Variable setzen',
			'Schritt 4 von 6: App neu starten',
			'Schritt 5 von 6: Stichwörter festlegen',
			'Schritt 6 von 6: Ersten Abruf starten'
		]);
		expect(dialog().queryByRole('status', { name: /Geprüft/ })).toBeNull();
	});
});

describe('setup assistant: the typed value stays in the window', () => {
	it('never reaches the data layer or web storage and is gone after closing', async () => {
		const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { data, onchange } = await open([calendar()], { kind: 'kalender', connectionId: ID });
		await fireEvent.click(dialog().getByRole('button', { name: /Variable setzen, offen/ }));

		const details = dialog().getByText('Wert hier einsetzen (bleibt in diesem Browserfenster)')
			.parentElement as HTMLDetailsElement;
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		const field = dialog().getByLabelText('iCal-Adresse') as HTMLInputElement;
		await fireEvent.input(field, { target: { value: SECRET } });
		await fireEvent.click(
			dialog().getByRole('button', {
				name: 'Befehl für die Eingabeaufforderung mit deinem Wert kopieren'
			})
		);
		await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
		expect(writeText.mock.calls[0]?.[0]).toBe(`setx BYL_GOOGLE_CALENDAR_URL "${SECRET}"`);

		await fireEvent.input(dialog().getByLabelText('iCal-Adresse'), { target: { value: SECRET } });
		await fireEvent.click(dialog().getByRole('button', { name: 'Später fortsetzen' }));
		expect(onchange).toHaveBeenLastCalledWith(null);
		await tick();

		const calls = JSON.stringify(
			Object.values(data).map((mock) => (mock as ReturnType<typeof vi.fn>).mock.calls)
		);
		expect(calls).not.toContain('geheim-4711');
		for (const storage of [localStorage, sessionStorage]) {
			for (const key of Object.keys(storage)) {
				expect(storage.getItem(key) ?? '').not.toContain('geheim-4711');
			}
		}
		expect(document.body.innerHTML).not.toContain('geheim-4711');
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
