// Connections on the page "Kanäle" (E4 plan, packages 10, 15, 17 and 20; ADR-0018, ADR-0020): list
// with the state of the variables, switch, errors and hints, the form with field errors, delete
// with a safety question, the hint before the migration, the setup of the variables, and the
// keywords with the answer of the bot to messages without one.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
import ChannelsView from './ChannelsView.svelte';
import ConnectionsSection from './ConnectionsSection.svelte';

const nativeDialog = {
	showModal: HTMLDialogElement.prototype.showModal,
	close: HTMLDialogElement.prototype.close
};

beforeAll(() => {
	if (typeof nativeDialog.showModal !== 'function') {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof nativeDialog.close !== 'function') {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.open = false;
		};
	}
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
	HTMLDialogElement.prototype.close = nativeDialog.close;
});

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
			replyNoMatch: settings.replyNoMatch
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
		}))
	} satisfies ConnectionsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	return { store: new ConnectionsStore(data, session), data, session };
}

describe('connections domain', () => {
	it('checks names of variables and the label', () => {
		expect(connectionDraftErrors(emptyConnectionDraft('telegram'))).toEqual({});
		expect(
			connectionDraftErrors({
				type: 'telegram',
				label: ' ',
				secretEnv: 'PATH',
				allowlistEnv: 'byl_x'
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

describe('connections section', () => {
	async function renderSection(statuses: Record<string, SecretStatus> = {}) {
		const context = setup([CAL, BOT], statuses);
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		return context;
	}

	it('lists each connection with variables, state, last run, error and hint', async () => {
		await renderSection({ [BOT.id]: { secret: false, allowlist: true } });
		const [cal, bot] = screen.getAllByRole('listitem');
		const calendar = within(cal as HTMLElement);
		expect(calendar.getByRole('heading', { name: 'Google Kalender' })).toBeTruthy();
		expect(calendar.getByText('BYL_GOOGLE_CALENDAR_URL')).toBeTruthy();
		expect(calendar.getByText('Zugangsdaten gesetzt.')).toBeTruthy();
		expect(calendar.getByText('25.09.2026 10:15')).toBeTruthy();
		const error = calendar.getByText(/Letzter Fehler: HTTP 404/);
		expect(error.closest('.alert-error')?.querySelector('svg')).not.toBeNull();
		const telegram = within(bot as HTMLElement);
		expect(telegram.getByText('BYL_TELEGRAM_ALLOWED_IDS')).toBeTruthy();
		expect(telegram.getAllByText('noch nie')).toHaveLength(2);
		expect(telegram.getByText(/Variable BYL_TELEGRAM_TOKEN anlegen/)).toBeTruthy();
		expect(telegram.getByText(/Chat-ID 424242/)).toBeTruthy();
	});

	it('switches a connection off', async () => {
		const { data, store } = await renderSection();
		const [cal] = screen.getAllByRole('listitem');
		await fireEvent.click(within(cal as HTMLElement).getByLabelText('Eingeschaltet'));
		expect(data.setEnabled).toHaveBeenCalledWith(CAL.id, false);
		await vi.waitFor(() => expect(store.announcement).toBe('„Google Kalender“ ist ausgeschaltet.'));
	});

	it('creates a Telegram connection with both variable names and marks wrong names', async () => {
		const { data } = await renderSection();
		await fireEvent.change(screen.getByLabelText('Art'), { target: { value: 'telegram' } });
		const token = screen.getByLabelText(
			'Variable mit dem Bot-Token (Pflichtfeld)'
		) as HTMLInputElement;
		expect(token.value).toBe('BYL_TELEGRAM_TOKEN');
		const allowlist = screen.getByLabelText(
			'Variable mit den erlaubten Chat- bzw. User-IDs (Pflichtfeld)'
		) as HTMLInputElement;
		expect(allowlist.value).toBe('BYL_TELEGRAM_ALLOWED_IDS');
		await fireEvent.input(allowlist, { target: { value: 'PATH' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(allowlist.getAttribute('aria-invalid')).toBe('true');
		expect(
			document.getElementById(allowlist.getAttribute('aria-describedby') ?? '')?.textContent
		).toMatch(/BYL_/);
		expect(data.create).not.toHaveBeenCalled();
		await fireEvent.input(allowlist, { target: { value: 'BYL_BOT_IDS' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Verbindung anlegen' }));
		expect(data.create).toHaveBeenCalledWith({
			type: 'telegram',
			label: 'Telegram-Bot',
			secretEnv: 'BYL_TELEGRAM_TOKEN',
			allowlistEnv: 'BYL_BOT_IDS'
		});
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
	});

	it('deletes after the safety question', async () => {
		const { data } = await renderSection();
		const [cal] = screen.getAllByRole('listitem');
		await fireEvent.click(within(cal as HTMLElement).getByRole('button', { name: 'Löschen' }));
		const dialog = screen.getByRole('dialog', { name: 'Verbindung „Google Kalender“ löschen?' });
		expect(dialog.textContent).toMatch(/Einträge, die schon im Eingang sind, bleiben/);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
		expect(data.remove).toHaveBeenCalledWith(CAL.id);
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
	});

	it('shows the hint before the migration neutrally', async () => {
		const { store, data } = setup();
		data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		await store.load();
		render(ConnectionsSection, { props: { store } });
		expect(screen.getByRole('status').textContent).toBe(CONNECTIONS_UNAVAILABLE_MESSAGE);
		expect(screen.queryByRole('alert')).toBeNull();
	});
});

describe('channels view: variables', () => {
	it('explains setx, the control panel and the restart', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store,
				importKeywords: new ImportKeywordsStore(
					{
						load: () => Promise.reject(new Error('not used')),
						save: () => Promise.reject(new Error('not used'))
					},
					{ ensureValid: () => true, logout: () => undefined }
				)
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
			'„Kalender“ ist ausgeschaltet.'
		);
	});

	it('runs a connection, announces the result and shows its new state', async () => {
		const context = setup();
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		const [cal] = screen.getAllByRole('listitem');
		await fireEvent.click(
			within(cal as HTMLElement).getByRole('button', { name: 'Jetzt abrufen' })
		);
		expect(context.data.run).toHaveBeenCalledWith(CAL.id);
		await vi.waitFor(() =>
			expect(context.store.announcement).toBe(
				'„Google Kalender“: 3 neu, 1 schon vorhanden, 1 aktualisiert.'
			)
		);
		await vi.waitFor(() =>
			expect(within(cal as HTMLElement).queryByText(/Letzter Fehler/)).toBeNull()
		);
		expect(within(cal as HTMLElement).getAllByText('25.09.2026 12:00')).toHaveLength(2);
	});

	it('offers no run for a switched-off connection and reloads with "Aktualisieren"', async () => {
		const context = setup([{ ...CAL, enabled: false }]);
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		const button = screen.getByRole('button', { name: 'Jetzt abrufen' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(button);
		expect(context.data.run).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
		expect(context.data.list).toHaveBeenCalledTimes(2);
	});

	it('explains how to set up Google Calendar and how to revoke the address', () => {
		const { store } = setup();
		render(ChannelsView, {
			props: {
				captureUrl: 'http://127.0.0.1:8090/eingang/neu',
				connections: store,
				importKeywords: new ImportKeywordsStore(
					{
						load: () => Promise.reject(new Error('not used')),
						save: () => Promise.reject(new Error('not used'))
					},
					{ ensureValid: () => true, logout: () => undefined }
				)
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
				connections: store,
				importKeywords: new ImportKeywordsStore(
					{
						load: () => Promise.reject(new Error('not used')),
						save: () => Promise.reject(new Error('not used'))
					},
					{ ensureValid: () => true, logout: () => undefined }
				)
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

describe('Stichwörter (E4 plan, package 20)', () => {
	it('warns at a connection without keywords and says where they are searched', async () => {
		const context = setup();
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		const [cal, bot] = screen.getAllByRole('listitem');
		const calendar = within(cal as HTMLElement);
		expect(calendar.getByText(NO_KEYWORDS_WARNING)).toBeTruthy();
		expect(calendar.getByText(/Titel und Beschreibung der Termine/)).toBeTruthy();
		expect(within(bot as HTMLElement).getByText(/im Text der Nachricht/)).toBeTruthy();
	});

	it('adds keywords and the suggestions and keeps the answer switch of the bot', async () => {
		const context = setup();
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		const [, bot] = screen.getAllByRole('listitem');
		const scope = within(bot as HTMLElement);
		await fireEvent.input(scope.getByLabelText('Neues Stichwort'), {
			target: { value: ' Einkauf ' }
		});
		await fireEvent.click(scope.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf'],
					replyNoMatch: true
				}
			)
		);
		await vi.waitFor(() =>
			expect(context.store.announcement).toBe('Stichwort „Einkauf“ hinzugefügt.')
		);
		await vi.waitFor(() =>
			expect((scope.getByLabelText('Neues Stichwort') as HTMLInputElement).value).toBe('')
		);
		const list = within(screen.getByRole('list', { name: 'Stichwörter von „Telegram-Bot“' }));
		expect(list.getByText('Einkauf')).toBeTruthy();

		const [, botAgain] = screen
			.getAllByRole('listitem')
			.filter((item) => item.classList.contains('connection'));
		await fireEvent.click(
			within(botAgain as HTMLElement).getByRole('button', { name: 'Vorschläge übernehmen' })
		);
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf', 'todo', 'aufgabe', 'erledigen', 'ticket', '#byl'],
					replyNoMatch: true
				}
			)
		);
		await vi.waitFor(() => expect(within(botAgain as HTMLElement).getByText('#byl')).toBeTruthy());

		await fireEvent.click(
			within(botAgain as HTMLElement).getByRole('checkbox', {
				name: /Auf Nachrichten ohne Stichwort antworten/
			})
		);
		await vi.waitFor(() =>
			expect(context.data.saveSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: BOT.id }),
				{
					keywords: ['Einkauf', 'todo', 'aufgabe', 'erledigen', 'ticket', '#byl'],
					replyNoMatch: false
				}
			)
		);
	});

	it('shows no answer switch for the calendar', async () => {
		const context = setup([CAL]);
		await context.store.load();
		render(ConnectionsSection, { props: { store: context.store } });
		expect(screen.queryByRole('checkbox', { name: /ohne Stichwort antworten/ })).toBeNull();
	});
});
