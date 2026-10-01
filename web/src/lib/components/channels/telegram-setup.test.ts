// Component tests of the Telegram assistant (ADR-0026 section 4, plan EH-6 §3.7/§3.13): six steps,
// the restart checks token and IDs, "Chat freigeben" reads the chat ID from the hint of a run and
// builds the finished command, the ID is no secret (an open field, no clipboard warning), and the
// check turns to "Kein fremder Chat mehr gemeldet" after the next run through realtime; the last step
// holds the switches of the answers of the bot (ADR-0016, addendum of 2026-10-01). The data layer
// is a fake; the store, the stepper and the modal are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecordChange } from '$lib/data/realtime';
import { TELEGRAM_REPLIES_HINT, type Connection, type SecretStatus } from '$lib/domain/connections';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000002';
const HINT = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';

function bot(overrides: Partial<Connection> = {}): Connection {
	return {
		id: ID,
		type: 'telegram',
		label: 'Telegram-Bot',
		enabled: true,
		secretEnv: 'BYL_TELEGRAM_TOKEN',
		allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: [],
		replySaved: true,
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

async function open(
	item: Connection,
	status: SecretStatus,
	afterRun: Partial<Connection> = { lastRunAt: '2026-09-26 10:00:00.000Z', lastHint: HINT }
) {
	const listeners: ((change: RecordChange<Connection>) => void)[] = [];
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => [item]),
		create: vi.fn<ConnectionsData['create']>(),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		rename: vi.fn<ConnectionsData['rename']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => status),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(async () =>
			bot({ ...afterRun, updated: '2026-09-26 10:00:00.000Z' })
		),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async (_id, onChange) => {
			listeners.push(onChange);
			return async () => undefined;
		}),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(async () => ({
			state: 'running' as const,
			version: '0.5.0',
			message: ''
		})),
		scan: vi.fn<ConnectionsData['scan']>(async () => ({ status: 'started' as const, message: '' }))
	} satisfies ConnectionsData;
	const store = new ConnectionsStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		new FlagStore()
	);
	await store.load();
	render(ChannelsViewHarness, {
		props: { connections: store, setup: { kind: 'telegram', connectionId: ID }, onchange: vi.fn() }
	});
	await tick();
	await tick();
	return {
		data,
		listeners,
		dialog: screen.getByRole('dialog', { name: 'Telegram-Bot einrichten' })
	};
}

const heading = (dialog: HTMLElement) =>
	within(dialog).getByRole('heading', { level: 3, name: /^Schritt \d von 6/ });

afterEach(() => {
	document.body.innerHTML = '';
	sessionStorage.clear();
});

describe('Telegram assistant (EH-6)', () => {
	it('waits at "Neu starten" until the app sees the token and the IDs', async () => {
		const { dialog } = await open(bot(), { secret: true, allowlist: false });
		expect(heading(dialog).textContent).toMatch(/^Schritt 4 von 6: App neu starten/);
		expect(
			within(dialog).getByText('Die App sieht BYL_TELEGRAM_ALLOWED_IDS noch nicht.')
		).toBeTruthy();
		expect(within(dialog).getByText(/Hast du setx schon ausgeführt\?/)).toBeTruthy();
	});

	it('reads the chat ID from the run and builds the finished command with an open field', async () => {
		const { dialog, data } = await open(bot(), { secret: true, allowlist: true });
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 6: Deinen Chat freigeben/);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt abrufen' }));
		await vi.waitFor(() => expect(data.run).toHaveBeenCalledWith(ID));
		await vi.waitFor(() =>
			expect(within(dialog).getByRole('heading', { name: /Erkannte Chat-ID: 424242/ })).toBeTruthy()
		);
		expect(
			within(dialog).getByText(
				'Nachricht aus einem Chat, der noch nicht freigegeben ist (Chat-ID 424242).'
			)
		).toBeTruthy();
		expect(
			within(dialog).getByRole('region', { name: 'Befehl mit der erkannten ID' }).textContent
		).toBe('setx BYL_TELEGRAM_ALLOWED_IDS "424242"');

		const details = within(dialog).getByText(
			'Wert hier einsetzen (bleibt in diesem Browserfenster)'
		).parentElement as HTMLDetailsElement;
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		const field = within(dialog).getByLabelText('Chat-IDs') as HTMLInputElement;
		expect(field.type).toBe('text');
		expect(within(dialog).queryByText(/Win\+V/)).toBeNull();
		await fireEvent.input(field, { target: { value: '424242,-100123456' } });
		expect(
			within(dialog).getByRole('region', { name: 'Befehl für mehrere IDs mit deinem Wert' })
				.textContent
		).toBe('setx BYL_TELEGRAM_ALLOWED_IDS "424242,-100123456"');
	});

	it('knows no foreign chat after the next run, through realtime', async () => {
		const { dialog, listeners } = await open(
			bot({ lastRunAt: '2026-09-26 10:00:00.000Z', lastHint: HINT }),
			{ secret: true, allowlist: true }
		);
		expect(heading(dialog).textContent).toMatch(/^Schritt 5 von 6/);
		// The assistant and, since KK-3, the card on the page follow the connection.
		await vi.waitFor(() => expect(listeners.length).toBe(2));
		// The user stays at the step (a choice holds it; without one the assistant follows the facts).
		await fireEvent.click(within(dialog).getByRole('button', { name: /Chat freigeben, aktuell/ }));

		listeners[0]?.({
			action: 'update',
			record: bot({
				lastRunAt: '2026-09-26 10:30:00.000Z',
				lastHint: '',
				updated: '2026-09-26 10:30:00.000Z'
			})
		});
		await vi.waitFor(() =>
			expect(within(dialog).getByText('Kein fremder Chat mehr gemeldet.')).toBeTruthy()
		);
		expect(within(dialog).queryByRole('heading', { name: /Erkannte Chat-ID/ })).toBeNull();
		// The step stays; the stepper marks it as done.
		expect(within(dialog).getByRole('button', { name: /Chat freigeben, aktuell/ })).toBeTruthy();
	});

	it('asks for keywords and a test message in the last step', async () => {
		const { dialog } = await open(
			bot({ lastRunAt: '2026-09-26 10:30:00.000Z', lastOkAt: '2026-09-26 10:30:00.000Z' }),
			{ secret: true, allowlist: true }
		);
		expect(heading(dialog).textContent).toMatch(
			/^Schritt 6 von 6: Stichwörter festlegen und testen/
		);
		expect(within(dialog).getByRole('textbox', { name: 'Neues Stichwort' })).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Jetzt abrufen' })).toBeTruthy();
		expect(within(dialog).getByText(/todo Test/)).toBeTruthy();
	});

	it('offers both answers of the bot as switches in the last step (ADR-0016, addendum of 2026-10-01)', async () => {
		const { dialog, data } = await open(
			bot({ lastRunAt: '2026-09-26 10:30:00.000Z', lastOkAt: '2026-09-26 10:30:00.000Z' }),
			{ secret: true, allowlist: true }
		);
		data.saveSettings.mockImplementation(async (current, settings) => ({
			...current,
			...settings
		}));
		const group = within(within(dialog).getByRole('group', { name: 'Antworten im Chat' }));
		expect(group.getByText(TELEGRAM_REPLIES_HINT)).toBeTruthy();
		const saved = group.getByRole<HTMLInputElement>('switch', { name: /^Bestätigung senden/ });
		const reply = group.getByRole<HTMLInputElement>('switch', {
			name: /^Hinweis bei fehlendem Stichwort senden/
		});
		expect([saved.checked, reply.checked]).toEqual([true, true]);

		await fireEvent.click(saved);
		await vi.waitFor(() =>
			expect(data.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), {
				keywords: [],
				replySaved: false,
				replyNoMatch: true,
				matchBody: false
			})
		);
		await vi.waitFor(() => expect(saved.checked).toBe(false));
		// The assistant stays at its step.
		expect(heading(dialog).textContent).toMatch(/^Schritt 6 von 6/);

		// A refused change says why and shows the saved value again.
		data.saveSettings.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		await fireEvent.click(reply);
		await vi.waitFor(() =>
			expect(within(dialog).getByText(/Der Server hat mit einem Fehler geantwortet/)).toBeTruthy()
		);
		await vi.waitFor(() => expect(reply.checked).toBe(true));
	});
});
