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
	NO_KEYWORDS_WARNING,
	runResultText,
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
		}))
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
	render(ChannelsView, {
		props: { captureUrl: 'http://127.0.0.1:8090/eingang/neu', connections: store }
	});
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

	it('creates a Telegram connection from the catalog and marks wrong names (EH-3)', async () => {
		const { store, data } = setup([CAL]);
		await store.load();
		renderView(store);
		await fireEvent.click(screen.getByRole('button', { name: 'Einrichten: Telegram-Bot' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Verbindung anlegen' }));
		expect((dialog.getByLabelText('Art') as HTMLSelectElement).value).toBe('telegram');
		const token = dialog.getByLabelText(
			'Variable mit dem Bot-Token (Pflichtfeld)'
		) as HTMLInputElement;
		expect(token.value).toBe('BYL_TELEGRAM_TOKEN');
		const allowlist = dialog.getByLabelText(
			'Variable mit den erlaubten Chat- bzw. User-IDs (Pflichtfeld)'
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
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(screen.getByRole('article', { name: 'Telegram-Bot' })).toBeTruthy();
		// The tile stays: several connections of a kind are allowed.
		expect(screen.getByRole('button', { name: 'Weitere einrichten: Telegram-Bot' })).toBeTruthy();
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
		expect(headings).toEqual([
			'Deine Verbindungen 2(2 Verbindungen)',
			'Selbst hereinbringen',
			'Kanal hinzufügen',
			'Anleitungen'
		]);
		const guides = document.querySelectorAll<HTMLDetailsElement>('.guide details');
		expect(guides).toHaveLength(5);
		expect([...guides].every((details) => !details.open)).toBe(true);
		const files = within(screen.getByRole('region', { name: 'Dateien hereinziehen' }));
		expect(files.getByRole('link', { name: 'Stichwörter bearbeiten' }).getAttribute('href')).toBe(
			'/einstellungen/datei-importe'
		);
		expect(files.getByRole('link', { name: 'Zum Eingang' }).getAttribute('href')).toBe('/eingang');
	});

	it('opens the guide of Proton from the catalog and of a card, with the focus on it (EH-3)', async () => {
		const { store } = setup([BOT], { [BOT.id]: { secret: false, allowlist: true } });
		await store.load();
		renderView(store);
		await fireEvent.click(screen.getByRole('button', { name: 'Anleitung: Proton Mail' }));
		const proton = screen.getByRole('region', { name: 'Proton Mail per Datei übernehmen' });
		await vi.waitFor(() => expect(proton.querySelector('details')?.open).toBe(true));
		expect(document.activeElement?.textContent).toBe('Proton Mail per Datei übernehmen');
		expect(within(proton).getByRole('link', { name: 'mail.proton.me' }).getAttribute('rel')).toBe(
			'noopener noreferrer'
		);
		await fireEvent.click(
			screen.getByRole('button', { name: 'Einrichtung fortsetzen: Telegram-Bot' })
		);
		const telegram = screen.getByRole('region', { name: 'Telegram-Bot einrichten' });
		await vi.waitFor(() => expect(telegram.querySelector('details')?.open).toBe(true));
		expect(document.activeElement?.textContent).toBe('Telegram-Bot einrichten');
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
	it('explains setx, the control panel and the restart', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store
			}
		});
		const section = screen.getByRole('region', {
			name: 'Zugangsdaten als Windows-Variable setzen'
		});
		const text = (section.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/setx BYL_TELEGRAM_TOKEN/);
		expect(text).toMatch(/Umgebungsvariablen für dieses Konto bearbeiten/);
		expect(text).toMatch(/stop\.bat und dann start\.bat/);
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

	it('explains how to set up Google Calendar and how to revoke the address', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store
			}
		});
		const section = screen.getByRole('region', { name: 'Google Calendar einrichten' });
		const text = (section.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/Einstellungen und Freigabe/);
		expect(text).toMatch(/Privatadresse im iCal-Format/);
		expect(text).toMatch(/setx BYL_GOOGLE_CALENDAR_URL/);
		expect(text).toMatch(/stop\.bat und dann start\.bat/);
		expect(text).toMatch(/Zurücksetzen/);
		const link = within(section).getByRole('link', { name: 'Google Calendar' });
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});
});

describe('Telegram-Bot einrichten (E4 plan, package 17)', () => {
	it('explains BotFather, the token, the own ID, the allowlist and the restart', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store
			}
		});
		const section = screen.getByRole('region', { name: 'Telegram-Bot einrichten' });
		const text = (section.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/@BotFather/);
		expect(text).toMatch(/\/newbot/);
		expect(text).toMatch(/setx BYL_TELEGRAM_TOKEN/);
		expect(text).toMatch(/nicht freigegebenen Chat \(Chat-ID …\)/);
		expect(text).toMatch(/setx BYL_TELEGRAM_ALLOWED_IDS/);
		expect(text).toMatch(/stop\.bat und dann start\.bat/);
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

	it('shows provider and user, no "Jetzt abrufen" and the switch for the text', async () => {
		const context = setup([MAIL]);
		await context.store.load();
		renderCards(context.store);
		const scope = card('Web.de');
		expect(scope.getByText('Postfach · Web.de · anna@web.de')).toBeTruthy();
		expect(scope.queryByRole('button', { name: /^Jetzt abrufen/ })).toBeNull();
		expect(scope.getByRole('button', { name: 'Aus dem Postfach wählen: Web.de' })).toBeTruthy();
		// The restart hint is no longer repeated at every mailbox (EH-3).
		expect(scope.queryByText(/byl-mail\.exe ruft dieses Postfach/)).toBeNull();
		await fireEvent.click(scope.getByRole('button', { name: 'Bearbeiten: Web.de' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Web.de bearbeiten' }));
		expect(dialog.getByText('BYL_WEBDE_PASSWORD')).toBeTruthy();
		expect(dialog.getByText(/im Betreff, auf Wunsch auch in den ersten 500 Zeichen/)).toBeTruthy();
		await fireEvent.click(
			dialog.getByRole('checkbox', { name: 'Auch die ersten 500 Zeichen des Textes durchsuchen' })
		);
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: MAIL.id }),
				{ keywords: ['todo'], replyNoMatch: true, matchBody: true }
			)
		);
		await vi.waitFor(() =>
			expect(latestFlag(context.flags)).toBe('„Web.de“ durchsucht auch den Anfang des Textes.')
		);
	});

	it('creates a mailbox from the tile "Web.de" with provider, user and the variable of the password', async () => {
		const { data } = await renderCatalog();
		await fireEvent.click(screen.getByRole('button', { name: 'Einrichten: Web.de' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Verbindung anlegen' }));
		expect((dialog.getByLabelText('Art') as HTMLSelectElement).value).toBe('mail');
		expect((dialog.getByLabelText('Anbieter') as HTMLSelectElement).value).toBe('webde');
		const secret = dialog.getByLabelText(
			'Variable mit dem Passwort bzw. App-Passwort des Postfachs (Pflichtfeld)'
		) as HTMLInputElement;
		expect(secret.value).toBe('BYL_WEBDE_PASSWORD');
		const user = dialog.getByLabelText(
			'Benutzername, meist die E-Mail-Adresse (Pflichtfeld)'
		) as HTMLInputElement;
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
	});

	it('suggests the Gmail variable and label for the tile "Gmail" and when the provider changes (E4 plan, package 13)', async () => {
		const { data } = await renderCatalog();
		await fireEvent.click(screen.getByRole('button', { name: 'Einrichten: Gmail' }));
		let dialog = within(screen.getByRole('dialog', { name: 'Verbindung anlegen' }));
		expect((dialog.getByLabelText('Anbieter') as HTMLSelectElement).value).toBe('gmail');
		const cancel = dialog.getAllByRole('button', { name: /Abbrechen|Schließen/ });
		await fireEvent.click(cancel[cancel.length - 1] as HTMLElement);
		expect(screen.queryByRole('dialog')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Einrichten: Web.de' }));
		dialog = within(screen.getByRole('dialog', { name: 'Verbindung anlegen' }));
		const provider = dialog.getByLabelText('Anbieter') as HTMLSelectElement;
		expect([...provider.options].map((option) => option.textContent)).toEqual(['Web.de', 'Gmail']);
		await fireEvent.change(provider, { target: { value: 'gmail' } });
		const secret = dialog.getByLabelText(
			'Variable mit dem Passwort bzw. App-Passwort des Postfachs (Pflichtfeld)'
		) as HTMLInputElement;
		expect(secret.value).toBe('BYL_GMAIL_PASSWORD');
		expect((dialog.getByLabelText('Bezeichnung (Pflichtfeld)') as HTMLInputElement).value).toBe(
			'Gmail'
		);
		await fireEvent.input(
			dialog.getByLabelText('Benutzername, meist die E-Mail-Adresse (Pflichtfeld)'),
			{ target: { value: 'anna@gmail.com' } }
		);
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

	async function renderCatalog() {
		const context = setup([CAL]);
		await context.store.load();
		renderView(context.store);
		return context;
	}
});

describe('Web.de-Postfach einrichten (E4 plan, package 11)', () => {
	it('explains IMAP access, the app password, the variable, the restart and the switch-off', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store
			}
		});
		const section = screen.getByRole('region', { name: 'Web.de-Postfach einrichten' });
		const text = (section.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/POP3- und IMAP-Zugriff erlauben/);
		expect(text).toMatch(/Anwendungsspezifische Passwörter verwalten/);
		expect(text).toMatch(/setx BYL_WEBDE_PASSWORD/);
		expect(text).toMatch(/Postfach \(IMAP\)/);
		expect(text).toMatch(/stop\.bat und dann start\.bat/);
		expect(text).toMatch(/BYL_INGEST_TOKEN/);
		expect(text).toMatch(/längere Zeit nicht genutzt/);
		expect(text).toContain('app\\logs\\byl-mail.log');
		expect(text).toMatch(/Gelesen-Status, Markierungen und Ordner bleiben/);
		// Package 23: older mails and mails without keyword come through the mailbox selection.
		expect(text).toMatch(/„Aus dem Postfach wählen“ an der Verbindung/);
	});
});

describe('Gmail einrichten (E4 plan, package 13)', () => {
	it('explains 2-Step Verification, the app password, the variable, the connection and the restart', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store
			}
		});
		const section = screen.getByRole('region', { name: 'Gmail einrichten' });
		const text = (section.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/Bestätigung in zwei Schritten/);
		expect(text).toContain('myaccount.google.com/apppasswords');
		expect(text).toMatch(/setx BYL_GMAIL_PASSWORD/);
		expect(text).toMatch(/Anbieter „Gmail“/);
		expect(text).toMatch(/stop\.bat und dann start\.bat/);
		expect(text).toMatch(/App-Passwort nötig/);
		expect(text).toMatch(/„Aus dem Postfach wählen“/);
		const link = within(section).getByRole('link', { name: 'myaccount.google.com/apppasswords' });
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
