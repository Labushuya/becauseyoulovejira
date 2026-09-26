// Component tests of the mailbox assistants and the Proton guide (ADR-0026 section 4, plan EH-7
// §3.7/§3.8): Web.de and Gmail in six steps, the keywords in the step "Verbinden", the first run
// of the helper that shows up through realtime without reloading, "Hilfsprozess prüfen" only on a
// click (unavailable and ok), the Gmail app password without spaces, and Proton as a modal M with
// "Zum Eingang". The data layer is a fake; the store, the stepper and the modal are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordChange } from '$lib/data/realtime';
import type { SetupTarget } from '$lib/domain/channel-setup';
import { NO_KEYWORDS_WARNING, type Connection, type SecretStatus } from '$lib/domain/connections';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000003';

function mailbox(overrides: Partial<Connection> = {}): Connection {
	return {
		id: ID,
		type: 'mail',
		label: 'Web.de',
		enabled: true,
		secretEnv: 'BYL_WEBDE_PASSWORD',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: [],
		replyNoMatch: true,
		mailProvider: 'webde',
		mailUser: 'anna@web.de',
		matchBody: false,
		runningSince: null,
		created: '2026-09-26 08:00:00.000Z',
		updated: '2026-09-26 08:00:00.000Z',
		...overrides
	};
}

async function open(
	items: Connection[],
	setup: SetupTarget,
	status: SecretStatus = { secret: true, allowlist: null }
) {
	const listeners: ((change: RecordChange<Connection>) => void)[] = [];
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => items),
		create: vi.fn<ConnectionsData['create']>(),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(async (current, settings) => ({
			...current,
			keywords: settings.keywords
		})),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => status),
		run: vi.fn<ConnectionsData['run']>(),
		get: vi.fn<ConnectionsData['get']>(async () => items[0] ?? mailbox()),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(async () => ({
			kind: 'unavailable' as const,
			message: 'Der Mail-Hilfsprozess läuft nicht.',
			hint: ''
		})),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async (_id, onChange) => {
			listeners.push(onChange);
			return async () => undefined;
		})
	} satisfies ConnectionsData;
	const store = new ConnectionsStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		new FlagStore()
	);
	await store.load();
	const onchange = vi.fn();
	render(ChannelsViewHarness, { props: { connections: store, setup, onchange } });
	await tick();
	await tick();
	return { data, store, listeners, onchange };
}

const heading = (dialog: HTMLElement) =>
	within(dialog).getByRole('heading', { level: 3, name: /^Schritt \d von 6/ });

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('mailbox assistant (EH-7)', () => {
	it('opens Web.de at "Abruf erlauben" with the link to the provider', async () => {
		await open([], { kind: 'webde', connectionId: null });
		const dialog = screen.getByRole('dialog', { name: 'Web.de einrichten' });
		expect(heading(dialog).textContent?.trim()).toBe('Schritt 1 von 6: Abruf per IMAP erlauben');
		expect(
			within(dialog)
				.getByRole('link', { name: /web\.de/ })
				.getAttribute('href')
		).toBe('https://web.de');
	});

	it('takes the keywords in "Verbinden" once the mailbox exists', async () => {
		const { data } = await open(
			[mailbox()],
			{ kind: 'webde', connectionId: ID },
			{
				secret: false,
				allowlist: null
			}
		);
		const dialog = screen.getByRole('dialog', { name: 'Web.de einrichten' });
		// The steps before "Verbinden" count as done once the mailbox exists; restart is open.
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 6: App neu starten/);
		await fireEvent.click(within(dialog).getByRole('button', { name: /Verbinden, erledigt/ }));
		expect(
			within(dialog).getByText(`Verbindung „Web.de“ angelegt. ${NO_KEYWORDS_WARNING}`)
		).toBeTruthy();
		await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Neues Stichwort' }), {
			target: { value: 'todo' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() => expect(data.saveSettings).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(within(dialog).getByText('Verbindung „Web.de“ angelegt.')).toBeTruthy()
		);
	});

	it('shows the first run of the helper through realtime, without reloading', async () => {
		const { data, listeners } = await open([mailbox({ keywords: ['todo'] })], {
			kind: 'webde',
			connectionId: ID
		});
		const dialog = screen.getByRole('dialog', { name: 'Web.de einrichten' });
		expect(heading(dialog).textContent).toMatch(/^Schritt 6 von 6: Auf den ersten Abruf warten/);
		expect(
			within(dialog).getByText('Warte auf den ersten Abruf (spätestens 5 Minuten) …')
		).toBeTruthy();
		expect(within(dialog).queryByRole('button', { name: 'Jetzt abrufen' })).toBeNull();
		// Package A: the step says openly that only mails after the first run come automatically.
		expect(
			within(dialog).getByText(
				/Automatisch kommen nur neue Mails, die danach eintreffen; ältere holst du über „Aus dem Postfach wählen“/
			)
		).toBeTruthy();
		await vi.waitFor(() => expect(listeners.length).toBe(1));

		listeners[0]?.({
			action: 'update',
			record: mailbox({
				keywords: ['todo'],
				lastRunAt: '2026-09-26 10:05:00.000Z',
				lastHint: 'Erster Abruf',
				updated: '2026-09-26 10:05:00.000Z'
			})
		});
		await vi.waitFor(() => expect(within(dialog).getByText(/^Abgerufen, zuletzt/)).toBeTruthy());
		expect(data.get).not.toHaveBeenCalled();
		expect(data.listMailbox).not.toHaveBeenCalled();
	});

	it('checks the helper only on a click and says whether it runs', async () => {
		const { data } = await open([mailbox({ keywords: ['todo'] })], {
			kind: 'webde',
			connectionId: ID
		});
		const dialog = screen.getByRole('dialog', { name: 'Web.de einrichten' });
		expect(data.listMailbox).not.toHaveBeenCalled();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hilfsprozess prüfen' }));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText(/Der Mail-Hilfsprozess läuft nicht\. Nach stop\.bat/)
			).toBeTruthy()
		);
		expect(data.listMailbox).toHaveBeenCalledWith(ID, 1, expect.anything());

		data.listMailbox.mockResolvedValueOnce({ kind: 'ok', value: [] });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Hilfsprozess prüfen' }));
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText('Der Mail-Hilfsprozess läuft und erreicht dein Postfach.')
			).toBeTruthy()
		);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erneut prüfen' }));
		await vi.waitFor(() => expect(data.get).toHaveBeenCalledWith(ID));
	});

	it('drops the spaces of the Gmail app password and says so', async () => {
		const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		await open([], { kind: 'gmail', connectionId: null });
		const dialog = screen.getByRole('dialog', { name: 'Gmail einrichten' });
		await fireEvent.click(within(dialog).getByRole('button', { name: /Variable setzen, offen/ }));

		const details = within(dialog).getByText(
			'Wert hier einsetzen (bleibt in diesem Browserfenster)'
		).parentElement as HTMLDetailsElement;
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		await fireEvent.input(within(dialog).getByLabelText('App-Passwort'), {
			target: { value: 'abcd efgh ijkl mnop' }
		});
		expect(
			within(dialog).getByText(/Leerzeichen zwischen den Vierergruppen sind entfernt/)
		).toBeTruthy();
		await fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Befehl für die Eingabeaufforderung mit deinem Wert kopieren'
			})
		);
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith('setx BYL_GMAIL_PASSWORD "abcdefghijklmnop"')
		);
		vi.unstubAllGlobals();
	});
});

describe('Proton guide (EH-7)', () => {
	it('opens as a modal M with three steps and leads to the inbox', async () => {
		const { onchange } = await open([], { kind: 'proton', connectionId: null });
		const dialog = screen.getByRole('dialog', { name: 'Proton-Mails übernehmen' });
		expect(dialog.classList.contains('size-m')).toBe(true);
		expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
		expect(
			within(dialog).queryByRole('navigation', { name: 'Schritte der Einrichtung' })
		).toBeNull();
		expect(
			within(dialog)
				.getByRole('link', { name: /mail\.proton\.me/ })
				.getAttribute('rel')
		).toBe('noopener noreferrer');
		expect(within(dialog).getByRole('link', { name: 'Zum Eingang' }).getAttribute('href')).toBe(
			'/eingang'
		);
		expect(
			within(dialog)
				.getByRole('link', { name: 'Stichwörter für Mail-Dateien' })
				.getAttribute('href')
		).toBe('/einstellungen/datei-importe');
		await fireEvent.click(
			within(dialog).getAllByRole('button', { name: 'Schließen' }).at(-1) as HTMLElement
		);
		expect(onchange).toHaveBeenLastCalledWith(null);
	});
});
