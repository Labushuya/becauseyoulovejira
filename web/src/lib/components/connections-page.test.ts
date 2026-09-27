// Connections on the page "Kanäle" (E4 plan, packages 10, 15, 17 and 20; ADR-0018, ADR-0020; since
// EH-3 as cards, ADR-0026 section 3): cards with state, errors and hints, pausing and deleting
// through the menu "…", creating through the catalog with field errors, the hint before the
// migration, the setup of the variables and the folded guides, and the keywords with the answer of
// the bot in "Bearbeiten"; mailboxes (package 22).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	connectionDraftErrors,
	emptyConnectionDraft,
	formatCount,
	mailScanOf,
	mailScanText,
	NO_KEYWORDS_WARNING,
	runResultText,
	scanResultText,
	secretStatusText,
	type Connection,
	type SecretStatus
} from '$lib/domain/connections';
import {
	CONNECTIONS_UNAVAILABLE_MESSAGE,
	ConnectionsStore,
	type ConnectionsData
} from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ImportKeywordsStore, type ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ChannelsView from './ChannelsView.svelte';
import ConnectionsSection from './ConnectionsSection.svelte';

// The safety question is the confirmation of ADR-0025 section 4 (since UI-3); jsdom has no
// showModal(), the shared stubs stand in (also for the mailbox picker).
useOverlayStubs();

function connection(id: string, overrides: Partial<Connection> = {}): Connection {
	return {
		id,
		type: 'calendar',
		label: 'Google Kalender',
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
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

const CAL = connection('conn00000000001', {
	lastRunAt: '2026-09-25 08:15:00.000Z',
	lastOkAt: '2026-09-25 08:00:00.000Z',
	lastError: 'HTTP 404 von https://calendar.google.com'
});
const BOT = connection('conn00000000002', {
	type: 'telegram',
	label: 'Telegram-Bot',
	secretEnv: 'BYL_TELEGRAM_TOKEN',
	allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
	lastHint: 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).',
	created: '2026-09-25 09:00:00.000Z'
});

function setup(items: Connection[] = [CAL, BOT], statuses: Record<string, SecretStatus> = {}) {
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => items),
		create: vi.fn<ConnectionsData['create']>(async (draft) =>
			connection('conn00000000009', {
				type: draft.type,
				label: draft.label,
				secretEnv: draft.secretEnv,
				allowlistEnv: draft.allowlistEnv,
				mailProvider: draft.type === 'mail' ? draft.mailProvider : '',
				mailUser: draft.type === 'mail' ? draft.mailUser : '',
				created: '2026-09-25 10:00:00.000Z'
			})
		),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(async (id, enabled) => ({
			...(items.find((item) => item.id === id) as Connection),
			enabled
		})),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(async (current, settings) => ({
			...current,
			keywords: settings.keywords,
			replyNoMatch: settings.replyNoMatch,
			matchBody: settings.matchBody
		})),
		remove: vi.fn<ConnectionsData['remove']>(async () => undefined),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(
			async (id) => statuses[id] ?? { secret: true, allowlist: null }
		),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 3,
			duplicates: 1,
			updated: 1,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(async (id) => ({
			...(items.find((item) => item.id === id) as Connection),
			lastRunAt: '2026-09-25 10:00:00.000Z',
			lastOkAt: '2026-09-25 10:00:00.000Z',
			lastError: ''
		})),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(async () => ({
			kind: 'ok' as const,
			value: []
		})),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(async () => ({
			kind: 'ok' as const,
			value: []
		})),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async () => async () => undefined),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(async () => ({
			state: 'running' as const,
			version: '0.5.0',
			message: ''
		})),
		scan: vi.fn<ConnectionsData['scan']>(async () => ({ status: 'started' as const, message: '' }))
	} satisfies ConnectionsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	return { store: new ConnectionsStore(data, session, flags), data, session, flags };
}

/** Title of the newest flag (ADR-0025 section 8), `undefined` without one. */
const latestFlag = (flags: FlagStore) => flags.flags[0]?.title;

describe('connections domain', () => {
	it('checks names of variables and the label', () => {
		expect(connectionDraftErrors(emptyConnectionDraft('telegram'))).toEqual({});
		expect(
			connectionDraftErrors({
				type: 'telegram',
				label: ' ',
				secretEnv: 'PATH',
				allowlistEnv: 'byl_x',
				mailProvider: 'webde',
				mailUser: ''
			})
		).toEqual({
			label: 'Pflichtfeld.',
			secretEnv: expect.stringContaining('BYL_'),
			allowlistEnv: expect.stringContaining('BYL_')
		});
	});

	it('names the missing variables and the restart', () => {
		expect(secretStatusText(BOT, null)).toBeNull();
		expect(secretStatusText(BOT, { secret: true, allowlist: true })).toEqual({
			ok: true,
			text: 'Zugangsdaten gesetzt.'
		});
		expect(secretStatusText(BOT, { secret: false, allowlist: false })?.text).toBe(
			'Zugangsdaten fehlen: Variablen BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS anlegen, dann die App neu starten (stop.bat, dann start.bat).'
		);
		expect(secretStatusText(CAL, { secret: false, allowlist: null })?.text).toMatch(
			/^Zugangsdaten fehlen: Variable BYL_GOOGLE_CALENDAR_URL anlegen/
		);
	});
});

describe('connections store', () => {
	it('loads the list and the state of the variables, and explains a missing collection', async () => {
		const { store, data } = setup();
		await store.load();
		expect(store.connections.map((item) => item.id)).toEqual([CAL.id, BOT.id]);
		expect(store.status(CAL.id)).toEqual({ secret: true, allowlist: null });
		expect(data.secretStatus).toHaveBeenCalledTimes(2);

		data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		const fresh = setup();
		fresh.data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await fresh.store.load();
		expect(fresh.store.error).toBe(CONNECTIONS_UNAVAILABLE_MESSAGE);
	});

	it('logs out on 401 and reports field errors of the server', async () => {
		const { store, data, session } = setup();
		data.list.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await store.load();
		expect(session.logout).toHaveBeenCalledOnce();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { secret_env: { code: 'validation_secret_name', message: 'Nur BYL_.' } }
			})
		);
		expect(await store.create(emptyConnectionDraft())).toEqual({
			ok: false,
			message: null,
			fields: { secret_env: 'Nur BYL_.' }
		});
	});
});

/** The section with fake callbacks for the catalog and the setup (EH-3). */
function renderCards(store: ConnectionsStore) {
	const onadd = vi.fn();
	const onsetup = vi.fn();
	render(ConnectionsSection, { props: { store, onadd, onsetup } });
	return { onadd, onsetup };
}

/** The card of a connection by its name (article with the name of its heading). */
function card(name: string) {
	return within(screen.getByRole('article', { name }));
}

/** Chooses an entry of the menu "…" of a card; jsdom shows popovers as hidden. */
async function chooseFromMenu(name: string, entry: string) {
	const trigger = screen.getByRole('button', { name: `Weitere Aktionen für ${name}` });
	await fireEvent.click(trigger);
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
	await fireEvent.click(
		within(menu as HTMLElement).getByRole('menuitem', { name: entry, hidden: true })
	);
}

/** The channels page with the catalog, for creating connections. */
function renderView(store: ConnectionsStore) {
	const onsetupchange = vi.fn();
	render(ChannelsView, {
		props: { captureUrl: 'http://127.0.0.1:8090/eingang/neu', connections: store, onsetupchange }
	});
	return { onsetupchange };
}

describe('connections section', () => {
	async function renderSection(statuses: Record<string, SecretStatus> = {}) {
		const context = setup([CAL, BOT], statuses);
		await context.store.load();
		return { ...context, ...renderCards(context.store) };
	}

	it('shows each connection as a card with state, last run, keywords and one hint (EH-3)', async () => {
		await renderSection({ [BOT.id]: { secret: false, allowlist: true } });
		expect(screen.getByRole('heading', { name: /Deine Verbindungen/ }).textContent).toMatch(
			/\(2 Verbindungen\)/
		);
		const calendar = card('Google Kalender');
		expect(calendar.getByText('Google Calendar')).toBeTruthy();
		expect(calendar.getByText('Fehler')).toBeTruthy();
		expect(calendar.getByText(/25\.09\.2026 10:15/)).toBeTruthy();
		expect(calendar.getByText(/zuletzt erfolgreich 25\.09\.2026 10:00/)).toBeTruthy();
		expect(calendar.getByText('keine')).toBeTruthy();
		const error = calendar.getByText(/Letzter Fehler: HTTP 404/);
		expect(error.closest('[data-tone="error"]')?.querySelector('svg')).not.toBeNull();
		const telegram = card('Telegram-Bot');
		expect(telegram.getByText('Nicht eingerichtet')).toBeTruthy();
		expect(telegram.getByText('noch nie')).toBeTruthy();
		expect(telegram.getByText(/Variable BYL_TELEGRAM_TOKEN anlegen/)).toBeTruthy();
		// One hint per card: the missing variable wins over the hint of the last run.
		expect(telegram.queryByText(/Chat-ID 424242/)).toBeNull();
		expect(
			telegram.getByRole('button', { name: 'Einrichtung fortsetzen: Telegram-Bot' })
		).toBeTruthy();
		// No switch "Eingeschaltet" any more, no variables on the card.
		expect(screen.queryByLabelText('Eingeschaltet')).toBeNull();
		expect(calendar.queryByText('BYL_GOOGLE_CALENDAR_URL')).toBeNull();
	});

	it('pauses and resumes a connection through the menu "…" (EH-3)', async () => {
		const { data, flags } = await renderSection();
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen für Google Kalender' });
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		await chooseFromMenu('Google Kalender', 'Pausieren');
		expect(data.setEnabled).toHaveBeenCalledWith(CAL.id, false);
		await vi.waitFor(() => expect(latestFlag(flags)).toBe('„Google Kalender“ ist pausiert.'));
		const calendar = card('Google Kalender');
		expect(calendar.getByText('Pausiert')).toBeTruthy();
		expect(calendar.getByText(/Die App ruft nichts ab/)).toBeTruthy();
		await fireEvent.click(calendar.getByRole('button', { name: 'Fortsetzen: Google Kalender' }));
		expect(data.setEnabled).toHaveBeenLastCalledWith(CAL.id, true);
		await vi.waitFor(() => expect(latestFlag(flags)).toBe('„Google Kalender“ läuft wieder.'));
	});

	it('creates a Telegram connection in the assistant and marks wrong names (EH-3, EH-6)', async () => {
		const { store, data } = setup([CAL]);
		await store.load();
		const onchange = vi.fn();
		render(ChannelsViewHarness, {
			props: { connections: store, setup: { kind: 'telegram', connectionId: null }, onchange }
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Telegram-Bot einrichten' }));
		await fireEvent.click(dialog.getByRole('button', { name: /Verbinden, offen/ }));
		const token = dialog.getByLabelText(
			'Name der Variablen für das Bot-Token (Pflichtfeld)'
		) as HTMLInputElement;
		expect(token.value).toBe('BYL_TELEGRAM_TOKEN');
		const allowlist = dialog.getByLabelText(
			'Name der Variablen für die erlaubten IDs (Pflichtfeld)'
		) as HTMLInputElement;
		expect(allowlist.value).toBe('BYL_TELEGRAM_ALLOWED_IDS');
		await fireEvent.input(allowlist, { target: { value: 'PATH' } });
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(allowlist.getAttribute('aria-invalid')).toBe('true');
		expect(
			document.getElementById(allowlist.getAttribute('aria-describedby') ?? '')?.textContent
		).toMatch(/BYL_/);
		expect(data.create).not.toHaveBeenCalled();
		await fireEvent.input(allowlist, { target: { value: 'BYL_BOT_IDS' } });
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(data.create).toHaveBeenCalledWith({
			type: 'telegram',
			label: 'Telegram-Bot',
			secretEnv: 'BYL_TELEGRAM_TOKEN',
			allowlistEnv: 'BYL_BOT_IDS',
			mailProvider: 'webde',
			mailUser: ''
		});
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({
				kind: 'telegram',
				connectionId: 'conn00000000009'
			})
		);
		expect(screen.getByRole('article', { name: 'Telegram-Bot' })).toBeTruthy();
		// The tile stays: several connections of a kind are allowed.
		expect(screen.getByRole('link', { name: 'Weitere einrichten: Telegram-Bot' })).toBeTruthy();
	});

	it('deletes through the menu after the safety question (EH-3)', async () => {
		const { data } = await renderSection();
		await chooseFromMenu('Google Kalender', 'Löschen …');
		const dialog = screen.getByRole('dialog', { name: 'Verbindung „Google Kalender“ löschen?' });
		expect(dialog.textContent).toMatch(/Einträge, die schon im Eingang sind, bleiben/);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
		expect(data.remove).toHaveBeenCalledWith(CAL.id);
		await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
	});

	it('leads to the setup of the kind of a connection (EH-3)', async () => {
		const { onsetup } = await renderSection({ [BOT.id]: { secret: false, allowlist: true } });
		await fireEvent.click(
			screen.getByRole('button', { name: 'Einrichtung fortsetzen: Telegram-Bot' })
		);
		expect(onsetup).toHaveBeenLastCalledWith(expect.objectContaining({ id: BOT.id }));
		await chooseFromMenu('Google Kalender', 'Einrichtung ansehen');
		expect(onsetup).toHaveBeenLastCalledWith(expect.objectContaining({ id: CAL.id }));
	});

	it('shows the hint before the migration neutrally', async () => {
		const { store, data } = setup();
		data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await store.load();
		renderCards(store);
		// Since EH-2 a section message with title (RESTART_NEEDED), announced as status.
		const status = screen.getByRole('status');
		expect(status.textContent).toMatch(/Hinweis:\s*Nach dem nächsten Neustart verfügbar/);
		expect(status.textContent).toMatch(/stop\.bat, dann start\.bat im Ordner app/);
		expect(status.getAttribute('data-tone')).toBe('info');
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('shows an empty state that leads to the catalog (EH-2, EH-3)', async () => {
		const { store } = setup([]);
		await store.load();
		renderView(store);

		expect(screen.getByRole('heading', { name: 'Noch kein Kanal verbunden' })).toBeTruthy();
		expect(screen.getByText(/Die Einrichtung dauert etwa fünf Minuten/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Kanal hinzufügen' }));
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Kanal hinzufügen' }));
	});

	it('reads like an overview: explanation, cards, own ways, catalog, folded guides (EH-3)', async () => {
		const { store } = setup();
		await store.load();
		renderView(store);
		const headings = screen
			.getAllByRole('heading', { level: 3 })
			.map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim());
		// Since EH-5 to EH-7 every service opens in the app: no section "Anleitungen" any more.
		expect(headings).toEqual([
			'Deine Verbindungen 2(2 Verbindungen)',
			'Selbst hereinbringen',
			'Kanal hinzufügen'
		]);
		expect(document.querySelectorAll('.guide details')).toHaveLength(0);
		const files = within(screen.getByRole('region', { name: 'Dateien hereinziehen' }));
		expect(files.getByRole('link', { name: 'Stichwörter bearbeiten' }).getAttribute('href')).toBe(
			'/einstellungen/datei-importe'
		);
		expect(files.getByRole('link', { name: 'Zum Eingang' }).getAttribute('href')).toBe('/eingang');
	});

	it('links Proton to its guide and opens the assistant of a card (EH-3, EH-6, EH-7)', async () => {
		const { store } = setup([BOT], { [BOT.id]: { secret: false, allowlist: true } });
		await store.load();
		const { onsetupchange } = renderView(store);
		const proton = screen.getByRole('link', { name: 'Anleitung: Proton Mail' });
		expect(proton.getAttribute('href')).toBe('/einstellungen/kanaele?einrichten=proton');
		await fireEvent.click(
			screen.getByRole('button', { name: 'Einrichtung fortsetzen: Telegram-Bot' })
		);
		expect(onsetupchange).toHaveBeenLastCalledWith({ kind: 'telegram', connectionId: BOT.id });
	});

	it('shows placeholder cards and a status while loading (EH-3)', () => {
		const { store, data } = setup();
		data.list.mockReturnValueOnce(new Promise(() => undefined));
		void store.load();
		const { container } = render(ConnectionsSection, {
			props: { store, onadd: vi.fn(), onsetup: vi.fn() }
		});
		expect(screen.getByRole('status').textContent).toBe('Verbindungen werden geladen …');
		expect(container.querySelectorAll('.placeholder')).toHaveLength(3);
		expect(container.querySelector('.placeholder')?.closest('[aria-hidden="true"]')).not.toBeNull();
	});

	it('shows a failed load as an error message with "Erneut versuchen" (EH-2)', async () => {
		const { store, data } = setup();
		data.list.mockRejectedValueOnce(new DataError('network'));
		await store.load();
		renderCards(store);

		const alert = screen.getByRole('alert');
		expect(alert.getAttribute('data-tone')).toBe('error');
		expect(alert.textContent).toMatch(/^\s*Fehler:/);
		await fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() => expect(screen.getAllByRole('article').length).toBeGreaterThan(0));
	});
});

describe('channels view: variables', () => {
	// The folded guide moved into the help with EH-9 (help-page.test.ts checks its text there).
	it('leads to the explanation of the access data in the help', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store,
				onsetupchange: vi.fn()
			}
		});
		expect(
			screen.queryByRole('region', { name: 'Zugangsdaten als Windows-Variable setzen' })
		).toBeNull();
		const link = screen.getByRole('link', { name: 'Wie funktionieren die Zugangsdaten?' });
		expect(link.getAttribute('href')).toBe('/einstellungen/hilfe#zugangsdaten');
	});
});

describe('Jetzt abrufen (E4 plan, package 15)', () => {
	it('describes every result of a run', () => {
		const base = {
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		};
		expect(
			runResultText('Kalender', {
				...base,
				status: 'ok',
				created: 3,
				duplicates: 1,
				updated: 2,
				skipped: 1
			})
		).toBe('„Kalender“: 3 neu, 1 schon vorhanden, 2 aktualisiert, 1 übersprungen.');
		expect(runResultText('Kalender', { ...base, status: 'ok' })).toBe('„Kalender“: 0 neu.');
		expect(runResultText('Bot', { ...base, status: 'ok', created: 1, unmatched: 2 })).toBe(
			'„Bot“: 1 neu, 2 ohne Stichwort.'
		);
		expect(runResultText('Kalender', { ...base, status: 'error', error: 'HTTP 404.' })).toBe(
			'„Kalender“: Abruf fehlgeschlagen. HTTP 404.'
		);
		expect(runResultText('Kalender', { ...base, status: 'missing', missing: ['BYL_X'] })).toMatch(
			/Zugangsdaten fehlen \(BYL_X\)/
		);
		expect(runResultText('Kalender', { ...base, status: 'running' })).toMatch(/ruft gerade ab/);
		expect(runResultText('Kalender', { ...base, status: 'disabled' })).toBe(
			'„Kalender“ ist pausiert.'
		);
	});

	it('runs a connection, announces the result and shows its new state', async () => {
		const context = setup();
		await context.store.load();
		renderCards(context.store);
		const calendar = card('Google Kalender');
		await fireEvent.click(calendar.getByRole('button', { name: 'Jetzt abrufen: Google Kalender' }));
		expect(context.data.run).toHaveBeenCalledWith(CAL.id);
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe(
				'„Google Kalender“: 3 neu, 1 schon vorhanden, 1 aktualisiert.'
			)
		);
		await vi.waitFor(() => expect(calendar.queryByText(/Letzter Fehler/)).toBeNull());
		// Last run and last success are the same now: one date, and the lozenge says so.
		await vi.waitFor(() => expect(calendar.getByText('Eingerichtet')).toBeTruthy());
		expect(calendar.getAllByText(/25\.09\.2026 12:00/)).toHaveLength(1);
	});

	it('shows "Wird abgerufen" while a run is going (EH-3)', async () => {
		const context = setup();
		context.data.run.mockReturnValueOnce(new Promise(() => undefined));
		await context.store.load();
		renderCards(context.store);
		const calendar = card('Google Kalender');
		await fireEvent.click(calendar.getByRole('button', { name: 'Jetzt abrufen: Google Kalender' }));
		expect(calendar.getByText('Wird abgerufen')).toBeTruthy();
		const busy = calendar.getByRole('button', { name: 'Wird abgerufen …: Google Kalender' });
		expect(busy.getAttribute('aria-busy')).toBe('true');
		expect(busy.getAttribute('aria-disabled')).toBe('true');
	});

	it('offers "Fortsetzen" instead of a run for a paused connection and reloads with "Aktualisieren"', async () => {
		const context = setup([{ ...CAL, enabled: false }]);
		await context.store.load();
		renderCards(context.store);
		expect(screen.queryByRole('button', { name: /^Jetzt abrufen/ })).toBeNull();
		expect(screen.getByRole('button', { name: 'Fortsetzen: Google Kalender' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
		expect(context.data.list).toHaveBeenCalledTimes(2);
	});

	it('leads to the assistant for Google Calendar instead of a guide (EH-5)', async () => {
		const { store } = setup([CAL]);
		await store.load();
		const { onsetupchange } = renderView(store);

		// The guide moved into the assistant (its texts: channel-setup.test.ts).
		expect(screen.queryByRole('region', { name: 'Google Calendar einrichten' })).toBeNull();
		const link = screen.getByRole('link', { name: 'Weitere einrichten: Google Calendar' });
		expect(link.getAttribute('href')).toBe('/einstellungen/kanaele?einrichten=kalender');
		expect(link.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		await chooseFromMenu('Google Kalender', 'Einrichtung ansehen');
		expect(onsetupchange).toHaveBeenLastCalledWith({ kind: 'kalender', connectionId: CAL.id });
	});
});

describe('Telegram-Bot einrichten (E4 plan, package 17; since EH-6 in the assistant)', () => {
	it('explains BotFather, the token, the own ID, the allowlist and the restart', async () => {
		const { store } = setup([]);
		const { text } = await allSteps(store, 'telegram', 'Telegram-Bot einrichten');
		expect(screen.queryByRole('region', { name: 'Telegram-Bot einrichten' })).toBeNull();
		expect(text).toMatch(/@BotFather/);
		expect(text).toMatch(/\/newbot/);
		expect(text).toMatch(/setx BYL_TELEGRAM_TOKEN/);
		expect(text).toMatch(/setx BYL_TELEGRAM_ALLOWED_IDS "0"/);
		expect(text).toMatch(/beginnt mit -100/);
		expect(text).toMatch(/stop\.bat, dann start\.bat/);
		expect(text).toMatch(/Im Eingang gespeichert/);
		expect(text).toMatch(/24 Stunden/);
		expect(text).toMatch(/\/revoke/);
	});
});

describe('Stichwörter (E4 plan, package 20; since EH-3 in "Bearbeiten")', () => {
	it('warns at a connection without keywords and says where they are searched', async () => {
		const context = setup([{ ...CAL, lastError: '' }, BOT]);
		await context.store.load();
		renderCards(context.store);
		expect(card('Google Kalender').getByText(NO_KEYWORDS_WARNING)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Google Kalender' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Google Kalender bearbeiten' }));
		expect(dialog.getByText(NO_KEYWORDS_WARNING)).toBeTruthy();
		expect(dialog.getByText(/Titel und Beschreibung der Termine/)).toBeTruthy();
		expect(dialog.getByText('BYL_GOOGLE_CALENDAR_URL')).toBeTruthy();
		// Every change is saved at once: the footer says "Schließen" (ADR-0025 section 3).
		const close = dialog.getAllByRole('button', { name: 'Schließen' });
		await fireEvent.click(close[close.length - 1] as HTMLElement);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('adds keywords and the suggestions and keeps the answer switch of the bot', async () => {
		const context = setup();
		await context.store.load();
		renderCards(context.store);
		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Telegram-Bot' }));
		const scope = within(screen.getByRole('dialog', { name: 'Telegram-Bot bearbeiten' }));
		expect(scope.getByText(/im Text der Nachricht/)).toBeTruthy();
		expect(scope.getByText('BYL_TELEGRAM_ALLOWED_IDS')).toBeTruthy();
		await fireEvent.input(scope.getByLabelText('Neues Stichwort'), {
			target: { value: ' Einkauf ' }
		});
		await fireEvent.click(scope.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf'],
					replyNoMatch: true,
					matchBody: false
				}
			)
		);
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe('Stichwort „Einkauf“ hinzugefügt.')
		);
		await vi.waitFor(() =>
			expect((scope.getByLabelText('Neues Stichwort') as HTMLInputElement).value).toBe('')
		);
		const list = within(scope.getByRole('list', { name: 'Stichwörter von „Telegram-Bot“' }));
		expect(list.getByText('Einkauf')).toBeTruthy();

		await fireEvent.click(scope.getByRole('button', { name: 'Vorschläge übernehmen' }));
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf', 'todo', 'aufgabe', 'erledigen', 'ticket', '#byl'],
					replyNoMatch: true,
					matchBody: false
				}
			)
		);
		await vi.waitFor(() => expect(scope.getByText('#byl')).toBeTruthy());
		// The card shows the number and the first three keywords.
		expect(card('Telegram-Bot').getByText('6 (Einkauf, todo, aufgabe, +3)')).toBeTruthy();

		await fireEvent.click(
			scope.getByRole('checkbox', {
				name: /Auf Nachrichten ohne Stichwort antworten/
			})
		);
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf', 'todo', 'aufgabe', 'erledigen', 'ticket', '#byl'],
					replyNoMatch: false,
					matchBody: false
				}
			)
		);
	});

	it('shows no answer switch for the calendar', async () => {
		const context = setup([CAL]);
		await context.store.load();
		renderCards(context.store);
		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Google Kalender' }));
		expect(screen.getByRole('dialog', { name: 'Google Kalender bearbeiten' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: /ohne Stichwort antworten/ })).toBeNull();
	});

	it('leads from "Bearbeiten" to the setup and closes the modal first (EH-3)', async () => {
		const context = setup([CAL]);
		await context.store.load();
		const { onsetup } = renderCards(context.store);
		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Google Kalender' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Einrichtung erneut ansehen' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(onsetup).toHaveBeenCalledWith(expect.objectContaining({ id: CAL.id }));
	});
});

describe('Postfächer (E4 plan, package 22)', () => {
	const MAIL = connection('conn00000000003', {
		type: 'mail',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		mailProvider: 'webde',
		mailUser: 'anna@web.de',
		keywords: ['todo']
	});

	it('checks the user name of a mailbox', () => {
		expect(
			connectionDraftErrors({ ...emptyConnectionDraft('mail'), mailUser: 'anna@web.de' })
		).toEqual({});
		for (const mailUser of ['', ' ', 'anna @web.de', `${'a'.repeat(250)}@x.de`]) {
			expect(connectionDraftErrors({ ...emptyConnectionDraft('mail'), mailUser })).toEqual({
				mailUser: expect.stringContaining('Benutzername')
			});
		}
	});

	it('shows provider and user, "Jetzt abrufen" and the switch for the text', async () => {
		const context = setup([MAIL]);
		await context.store.load();
		renderCards(context.store);
		const scope = card('Web.de');
		expect(scope.getByText('Postfach · Web.de · anna@web.de')).toBeTruthy();
		expect(scope.getByRole('button', { name: 'Jetzt abrufen: Web.de' })).toBeTruthy();
		expect(scope.getByRole('button', { name: 'Aus dem Postfach wählen: Web.de' })).toBeTruthy();
		// The restart hint is no longer repeated at every mailbox (EH-3).
		expect(scope.queryByText(/byl-mail\.exe ruft dieses Postfach/)).toBeNull();
		await fireEvent.click(scope.getByRole('button', { name: 'Bearbeiten: Web.de' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Web.de bearbeiten' }));
		expect(dialog.getByText('BYL_WEBDE_PASSWORD')).toBeTruthy();
		expect(
			dialog.getByText(
				/in Betreff und Absender \(Name und Adresse\), mit „Betreff, Absender, Kopfzeilen und Text durchsuchen“ \(Standard\) auch in den Kopfzeilen .* und im ganzen Text/
			)
		).toBeTruthy();
		await fireEvent.click(
			dialog.getByRole('checkbox', { name: 'Betreff, Absender, Kopfzeilen und Text durchsuchen' })
		);
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: MAIL.id }),
				{ keywords: ['todo'], replyNoMatch: true, matchBody: true }
			)
		);
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe(
				'„Web.de“ durchsucht Betreff, Absender, Kopfzeilen und Text.'
			)
		);
	});

	it('shows the number of keywords per kind of file on the files card (EH-7)', async () => {
		const { store } = setup([]);
		const importKeywords = new ImportKeywordsStore(
			{
				load: vi.fn<ImportKeywordsData['load']>(async () => ({
					...EMPTY_IMPORT_KEYWORDS,
					eml: { keywords: ['todo', 'rechnung', '#byl'], matchBody: false },
					whatsapp: { keywords: ['todo', 'einkauf'], matchBody: false }
				})),
				save: vi.fn<ImportKeywordsData['save']>()
			},
			{ ensureValid: () => true, logout: vi.fn() }
		);
		await Promise.all([store.load(), importKeywords.load()]);
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store,
				importKeywords,
				onsetupchange: vi.fn()
			}
		});
		const files = within(screen.getByRole('region', { name: 'Dateien hereinziehen' }));
		expect(files.getByText('Stichwörter: Mail 3 · Kalender 0 · WhatsApp 2')).toBeTruthy();
	});

	it('links the tiles "Web.de" and "Gmail" to their assistants (EH-7)', async () => {
		const { store } = setup([CAL]);
		await store.load();
		renderView(store);
		expect(screen.getByRole('link', { name: 'Einrichten: Web.de' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele?einrichten=webde'
		);
		expect(screen.getByRole('link', { name: 'Einrichten: Gmail' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele?einrichten=gmail'
		);
		expect(screen.queryByRole('button', { name: /^Einrichten: (Web\.de|Gmail)/ })).toBeNull();
	});

	it('creates a mailbox from the tile "Web.de" with provider, user and the variable of the password', async () => {
		const { data, store } = setup([]);
		await store.load();
		const onchange = vi.fn();
		render(ChannelsViewHarness, {
			props: { connections: store, setup: { kind: 'webde', connectionId: null }, onchange }
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Web.de einrichten' }));
		await fireEvent.click(dialog.getByRole('button', { name: /Verbinden, offen/ }));
		const secret = dialog.getByLabelText(/Name der Variablen für das Passwort/) as HTMLInputElement;
		expect(secret.value).toBe('BYL_WEBDE_PASSWORD');
		const user = dialog.getByLabelText(/E-Mail-Adresse des Postfachs/) as HTMLInputElement;
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(user.getAttribute('aria-invalid')).toBe('true');
		expect(data.create).not.toHaveBeenCalled();
		await fireEvent.input(user, { target: { value: ' anna@web.de ' } });
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(data.create).toHaveBeenCalledWith({
			type: 'mail',
			label: 'Web.de',
			secretEnv: 'BYL_WEBDE_PASSWORD',
			allowlistEnv: '',
			mailProvider: 'webde',
			mailUser: ' anna@web.de '
		});
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({ kind: 'webde', connectionId: 'conn00000000009' })
		);
	});

	it('suggests the Gmail variable and label in the assistant for the tile "Gmail" (E4 plan, package 13; EH-7)', async () => {
		const { data, store } = setup([]);
		await store.load();
		render(ChannelsViewHarness, {
			props: { connections: store, setup: { kind: 'gmail', connectionId: null }, onchange: vi.fn() }
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Gmail einrichten' }));
		await fireEvent.click(dialog.getByRole('button', { name: /Verbinden, offen/ }));
		expect(
			(dialog.getByLabelText(/Name der Variablen für das Passwort/) as HTMLInputElement).value
		).toBe('BYL_GMAIL_PASSWORD');
		expect((dialog.getByLabelText('Bezeichnung (Pflichtfeld)') as HTMLInputElement).value).toBe(
			'Gmail'
		);
		await fireEvent.input(dialog.getByLabelText(/E-Mail-Adresse des Postfachs/), {
			target: { value: 'anna@gmail.com' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(data.create).toHaveBeenCalledWith({
			type: 'mail',
			label: 'Gmail',
			secretEnv: 'BYL_GMAIL_PASSWORD',
			allowlistEnv: '',
			mailProvider: 'gmail',
			mailUser: 'anna@gmail.com'
		});
	});
});

/** The text of all steps of an assistant ("Alle Schritte anzeigen"). */
async function allSteps(
	store: ConnectionsStore,
	kind: 'webde' | 'gmail' | 'telegram',
	title: string
) {
	await store.load();
	render(ChannelsViewHarness, {
		props: { connections: store, setup: { kind, connectionId: null }, onchange: vi.fn() }
	});
	const dialog = screen.getByRole('dialog', { name: title });
	await fireEvent.click(within(dialog).getByRole('button', { name: 'Alle Schritte anzeigen' }));
	return { dialog, text: (dialog.textContent ?? '').replace(/\s+/g, ' ') };
}

describe('Web.de-Postfach einrichten (E4 plan, package 11; since EH-7 in the assistant)', () => {
	it('explains IMAP access, the app password, the variable, the restart and the switch-off', async () => {
		const { store } = setup([]);
		const { text } = await allSteps(store, 'webde', 'Web.de einrichten');
		expect(screen.queryByRole('region', { name: 'Web.de-Postfach einrichten' })).toBeNull();
		expect(text).toMatch(/POP3- und IMAP-Zugriff erlauben/);
		expect(text).toMatch(/Anwendungsspezifische Passwörter verwalten/);
		expect(text).toMatch(/setx BYL_WEBDE_PASSWORD/);
		expect(text).toMatch(/stop\.bat, dann start\.bat/);
		expect(text).toMatch(/BYL_INGEST_TOKEN/);
		expect(text).toMatch(/längere Zeit nicht genutzt/);
		expect(text).toContain('app\\logs\\byl-mail.log');
		expect(text).toMatch(/Gelesen-Status, Markierungen und Ordner bleiben/);
		// Package 23: older mails and mails without keyword come through the mailbox selection.
		expect(text).toMatch(/„Aus dem Postfach wählen“ an der Karte/);
	});
});

describe('Gmail einrichten (E4 plan, package 13; since EH-7 in the assistant)', () => {
	it('explains 2-Step Verification, the app password, the variable, the connection and the restart', async () => {
		const { store } = setup([]);
		const { dialog, text } = await allSteps(store, 'gmail', 'Gmail einrichten');
		expect(text).toMatch(/Bestätigung in zwei Schritten/);
		expect(text).toMatch(/setx BYL_GMAIL_PASSWORD/);
		expect(text).toMatch(/Anbieter Gmail/);
		expect(text).toMatch(/stop\.bat, dann start\.bat/);
		expect(text).toMatch(/Anmeldung bei Gmail abgelehnt/);
		expect(text).toMatch(/„Aus dem Postfach wählen“/);
		const link = within(dialog).getByRole('link', { name: /myaccount\.google\.com\/apppasswords/ });
		expect(link.getAttribute('href')).toBe('https://myaccount.google.com/apppasswords');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});
});

describe('Aus dem Postfach wählen (E4 plan, package 23)', () => {
	const MAILBOX = connection('conn00000000004', {
		type: 'mail',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		mailProvider: 'webde',
		mailUser: 'anna@web.de'
	});

	it('opens the selection of a mailbox and announces the import', async () => {
		const context = setup([MAILBOX]);
		context.data.listMailbox.mockResolvedValue({
			kind: 'ok',
			value: [
				{
					uid: 7,
					size: 1000,
					subject: 'Alte Mail',
					from: 'Bert',
					date: null,
					keyword: '',
					state: '',
					stateMessage: ''
				}
			]
		});
		context.data.importMailbox.mockResolvedValue({
			kind: 'ok',
			value: [{ uid: 7, status: 'created', message: '' }]
		});
		await context.store.load();
		renderCards(context.store);
		await fireEvent.click(screen.getByRole('button', { name: 'Aus dem Postfach wählen: Web.de' }));
		const dialog = await screen.findByRole('dialog', { name: 'Aus dem Postfach wählen' });
		expect(context.data.listMailbox).toHaveBeenCalledWith(MAILBOX.id, 50, {
			signal: expect.any(AbortSignal)
		});
		await fireEvent.click(await within(dialog).findByRole('checkbox'));
		await fireEvent.click(within(dialog).getByRole('button', { name: '1 Mail in den Eingang' }));
		expect(context.data.importMailbox).toHaveBeenCalledWith(MAILBOX.id, [7]);
		await vi.waitFor(() => expect(latestFlag(context.flags)).toBe('„Web.de“: 1 neu.'));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		expect(screen.queryByRole('dialog', { name: 'Aus dem Postfach wählen' })).toBeNull();
	});

	it('offers "Fortsetzen" instead of the selection at a paused mailbox (EH-3)', async () => {
		const context = setup([{ ...MAILBOX, enabled: false }]);
		await context.store.load();
		renderCards(context.store);
		expect(screen.queryByRole('button', { name: /^Aus dem Postfach wählen/ })).toBeNull();
		const scope = card('Web.de');
		expect(scope.getByText(/Der Hilfsprozess ruft pausierte Postfächer nicht ab/)).toBeTruthy();
		await fireEvent.click(scope.getByRole('button', { name: 'Fortsetzen: Web.de' }));
		expect(context.data.setEnabled).toHaveBeenCalledWith(MAILBOX.id, true);
		expect(screen.queryByRole('alert')).toBeNull();
		expect(context.data.listMailbox).not.toHaveBeenCalled();
	});

	it('offers the selection only at mailboxes', async () => {
		const context = setup();
		await context.store.load();
		renderCards(context.store);
		expect(screen.queryByRole('button', { name: /^Aus dem Postfach wählen/ })).toBeNull();
	});
});

describe('Jetzt abrufen at a mailbox (package A, item 4)', () => {
	const MAILBOX = connection('conn00000000005', {
		type: 'mail',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		mailProvider: 'webde',
		mailUser: 'anna@web.de',
		keywords: ['europa-go']
	});
	const NOT_RUNNING =
		'Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet). Mit einer eingeschalteten Postfach-Verbindung startet start.bat ihn mit; sonst stop.bat und dann start.bat ausführen.';

	it('probes the helper only with a mailbox in the list', async () => {
		const without = setup([CAL]);
		await without.store.load();
		expect(without.data.helperStatus).not.toHaveBeenCalled();
		expect(without.store.helper).toBeNull();

		const context = setup([CAL, MAILBOX]);
		await context.store.load();
		expect(context.data.helperStatus).toHaveBeenCalledOnce();
		renderCards(context.store);
		expect(card('Web.de').getByText('läuft (byl-mail 0.5.0)')).toBeTruthy();
	});

	it('runs the mailbox, shows the result on the card and probes the helper again', async () => {
		const context = setup([MAILBOX]);
		context.data.run.mockResolvedValueOnce({
			status: 'ok',
			created: 1,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 2,
			error: '',
			missing: []
		});
		await context.store.load();
		renderCards(context.store);
		await fireEvent.click(card('Web.de').getByRole('button', { name: 'Jetzt abrufen: Web.de' }));
		expect(context.data.run).toHaveBeenCalledWith(MAILBOX.id);
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe('„Web.de“: 1 neu, 2 ohne Stichwort.')
		);
		await vi.waitFor(() => expect(context.data.helperStatus).toHaveBeenCalledTimes(2));
		expect(card('Web.de').getByText('1 neu, 2 ohne Stichwort')).toBeTruthy();
	});

	it('says neutrally when the helper does not run', async () => {
		const context = setup([MAILBOX]);
		context.data.helperStatus.mockResolvedValue({ state: 'stopped', version: '', message: '' });
		context.data.run.mockResolvedValueOnce({
			status: 'unavailable',
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: NOT_RUNNING,
			missing: []
		});
		await context.store.load();
		renderCards(context.store);
		await fireEvent.click(card('Web.de').getByRole('button', { name: 'Jetzt abrufen: Web.de' }));
		await vi.waitFor(() => expect(latestFlag(context.flags)).toBe(`„Web.de“: ${NOT_RUNNING}`));
		expect(context.flags.flags[0]?.tone).toBe('info');
		expect(card('Web.de').getByText('Hilfsprozess läuft nicht')).toBeTruthy();
		expect(card('Web.de').getByText(/^läuft nicht\./)).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('focuses the card named in the address (link of the flag "Alle Kanäle jetzt abrufen")', async () => {
		const context = setup([CAL, MAILBOX]);
		window.history.replaceState(null, '', `#verbindung-${MAILBOX.id}`);
		try {
			await context.store.load();
			renderCards(context.store);
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Web.de' }))
			);
		} finally {
			window.history.replaceState(null, '', window.location.pathname);
		}
	});
});

describe('full scan of an inbox on the page (ADR-0020, addendum 3)', () => {
	const MAILBOX = connection('conn00000000006', {
		type: 'mail',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		mailProvider: 'webde',
		mailUser: 'anna@web.de',
		keywords: ['todo'],
		scan: { state: 'done', done: 10, total: 10, created: 2, fallback: false }
	});

	it('reads, formats and announces the scan', () => {
		expect(
			mailScanOf({
				state: 'running',
				done: 1200,
				total: 4800,
				created: 3,
				fallback: true,
				match_body_before: false
			})
		).toEqual({
			state: 'running',
			done: 1200,
			total: 4800,
			created: 3,
			fallback: true
		});
		expect(mailScanOf({ state: 'kaputt' })).toBeNull();
		expect(mailScanOf({ match_body_before: false })).toBeNull();
		expect(mailScanOf(null)).toBeNull();
		expect(mailScanOf({ state: 'done', done: -1, total: 'x' })).toMatchObject({
			done: 0,
			total: 0
		});
		expect([0, 999, 1000, 4800, 1234567].map(formatCount)).toEqual([
			'0',
			'999',
			'1.000',
			'4.800',
			'1.234.567'
		]);
		expect(mailScanText({ state: 'done', done: 1, total: 1, created: 1, fallback: false })).toBe(
			'durchsucht: 1 Mail, 1 Eintrag übernommen'
		);
		expect(
			mailScanText({ state: 'error', done: 500, total: 4800, created: 0, fallback: false })
		).toBe('unterbrochen bei 500/4.800, geht beim nächsten Abruf weiter');
		expect(scanResultText('Web.de', { status: 'started', message: '' })).toEqual({
			text: '„Web.de“: Der Posteingang wird durchsucht.',
			tone: 'info'
		});
		expect(scanResultText('Web.de', { status: 'error', message: 'Kaputt.' })).toEqual({
			text: '„Web.de“: Kaputt.',
			tone: 'error'
		});
		expect(scanResultText('Web.de', { status: 'unavailable', message: 'Läuft nicht.' }).tone).toBe(
			'info'
		);
	});

	it('starts the scan from the menu, announces it and follows the progress through realtime', async () => {
		const context = setup([CAL, MAILBOX]);
		const listeners: Parameters<ConnectionsData['subscribe']>[1][] = [];
		context.data.subscribe.mockImplementation(async (_id, onChange) => {
			listeners.push(onChange);
			return async () => undefined;
		});
		await context.store.load();
		renderCards(context.store);
		// Only mailboxes are watched.
		await vi.waitFor(() => expect(context.data.subscribe).toHaveBeenCalledOnce());
		expect(context.data.subscribe.mock.calls[0]?.[0]).toBe(MAILBOX.id);
		expect(card('Web.de').getByText('durchsucht: 10 Mails, 2 Einträge übernommen')).toBeTruthy();

		await chooseFromMenu('Web.de', 'Posteingang neu durchsuchen');
		expect(context.data.scan).toHaveBeenCalledWith(MAILBOX.id, 'start');
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe('„Web.de“: Der Posteingang wird durchsucht.')
		);

		listeners[0]?.({
			action: 'update',
			record: {
				...MAILBOX,
				scan: { state: 'running', done: 500, total: 4800, created: 0, fallback: false },
				updated: '2026-09-27 12:00:00.000Z'
			}
		});
		await vi.waitFor(() =>
			expect(card('Web.de').getByText('wird durchsucht: 500/4.800')).toBeTruthy()
		);

		context.data.scan.mockResolvedValueOnce({ status: 'cancelling', message: '' });
		await fireEvent.click(
			card('Web.de').getByRole('button', { name: 'Abbrechen: Durchsuchen von Web.de' })
		);
		expect(context.data.scan).toHaveBeenLastCalledWith(MAILBOX.id, 'cancel');
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe('„Web.de“: Das Durchsuchen wird abgebrochen.')
		);
	});

	it('shows a failed scan request as error flag, a stopped helper neutrally', async () => {
		const context = setup([MAILBOX]);
		await context.store.load();
		renderCards(context.store);
		context.data.scan.mockResolvedValueOnce({
			status: 'unavailable',
			message: 'Der Mail-Hilfsprozess läuft nicht.'
		});
		await chooseFromMenu('Web.de', 'Posteingang neu durchsuchen');
		await vi.waitFor(() => expect(context.flags.flags[0]?.tone).toBe('info'));
		context.data.scan.mockRejectedValueOnce(new DataError('network'));
		await chooseFromMenu('Web.de', 'Posteingang neu durchsuchen');
		await vi.waitFor(() => expect(card('Web.de').getByRole('alert')).toBeTruthy());
	});
});
