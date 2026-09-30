// Page "Einstellungen → System" (ADR-0043) in jsdom with the real store and fake data: the hint for
// a server that is not on Windows, the refusals, the state with the PID only in the details, the
// restart with its question and progress, the mail helper, the autostart switch, "Umgebung prüfen"
// and the logs. Buttons of actions stay focusable while one runs (aria-disabled).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { SystemAnswer } from '$lib/data/system';
import { parseOverview, type SystemOverview, type SystemStatus } from '$lib/domain/system';
import { SystemStore, type SystemData } from '$lib/stores/system.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import SystemView from './SystemView.svelte';

useOverlayStubs();

function overview(status: Partial<SystemStatus> = {}, running = false): SystemOverview {
	const parsed = parseOverview({
		appDir: 'C:\\Apps\\becauseyoulovejira\\app',
		status: {
			state: 'running',
			pid: 4321,
			port: 8090,
			configuredPort: 8090,
			url: 'http://127.0.0.1:8090/',
			startedUtc: '2026-09-30T07:15:00Z',
			verdict: 'current',
			restartReasons: [],
			reload: false,
			mailHelperPid: running ? 777 : null,
			otherServers: [],
			autostart: 'off',
			...status
		},
		mail: { installed: true, running, blocker: running ? '' : 'no-mailbox' }
	});
	if (parsed === null) throw new Error('not an overview');
	return parsed;
}

const ok = <T>(value: T): SystemAnswer<T> => ({ kind: 'ok', value });

async function show(data: Partial<SystemData> = {}, platform: 'windows' | 'linux' = 'windows') {
	const full: SystemData = {
		status: vi.fn(async () => ok(overview())),
		doctor: vi.fn(async () => ok({ ok: true, checks: [] })),
		logs: vi.fn(async () => ok({ lines: 200, logs: [] })),
		act: vi.fn(async () => ok(overview())),
		health: vi.fn(async () => true),
		...data
	};
	const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
	// Time passes only while the store waits between two questions to the server.
	let now = 0;
	const store = new SystemStore(full, { ensureValid: () => true, logout: vi.fn() }, flags, {
		now: () => now,
		wait: async (ms) => {
			now += ms;
		}
	});
	if (platform === 'windows') await store.load();
	render(SystemView, { props: { store, platform } });
	await tick();
	return { store, data: full, flags };
}

describe('page System', () => {
	it('shows only a hint for a server that is not on Windows', async () => {
		const { data } = await show({}, 'linux');
		expect(screen.getByText('Nur für einen Server unter Windows')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		expect(data.status).not.toHaveBeenCalled();
	});

	it('shows a refusal with its text and loads again on request', async () => {
		const { data } = await show({
			status: vi.fn(async () => ({ kind: 'denied', reason: 'loopback' }) as const)
		});
		expect(screen.getByText('Nur auf dem Rechner der App')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
		expect(data.status).toHaveBeenCalledTimes(2);
	});

	it('shows the state of the app, the PID only in the technical details', async () => {
		await show({
			status: vi.fn(async () =>
				ok(
					overview({
						configuredPort: 8091,
						otherServers: [
							{ pid: 9, path: 'D:\\Kopie\\app\\pocketbase.exe', port: 8092, sameFolder: false }
						]
					})
				)
			)
		});
		const state = within(screen.getByRole('region', { name: 'Zustand' }));
		const rows = Object.fromEntries(
			state
				.getAllByRole('term', { hidden: true })
				.map((term) => [
					term.textContent?.trim(),
					term.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim()
				])
		);
		expect(rows).toMatchObject({
			Server: 'Läuft seit 30.09.2026 09:15',
			Adresse: 'http://127.0.0.1:8090/ Eingestellt ist Port 8091; er gilt nach dem Neustart.',
			Stand: 'Aktuell',
			'Mail-Helfer': 'Läuft nicht Kein Postfach ist eingeschaltet; er wird nicht gebraucht.',
			Autostart: 'Aus',
			'Andere Kopien':
				'Andere Kopie auf Port 8092 · D:\\Kopie\\app\\pocketbase.exe Nur ein Hinweis; sie bleiben unberührt.',
			'Prozess-ID (PID)': '4321',
			Ordner: 'C:\\Apps\\becauseyoulovejira\\app'
		});
		const details = screen.getByText('Technische Angaben').closest('details');
		expect(details?.open).toBe(false);
		expect(within(details as HTMLElement).getByText('4321')).toBeTruthy();
	});

	it('offers the restart as the main action only when it is needed', async () => {
		await show();
		const quiet = screen.getByRole('button', { name: 'Jetzt neu starten' });
		expect(quiet.className).toBe('button-secondary');
		expect(screen.getByText(/Zurzeit nicht nötig\. Anders als neu-starten\.bat/)).toBeTruthy();
		document.body.innerHTML = '';
		await show({
			status: vi.fn(async () =>
				ok(overview({ verdict: 'restart', restartReasons: ['migrations'] }))
			)
		});
		const needed = screen.getByRole('button', { name: 'Jetzt neu starten' });
		expect(needed.className).toBe('button-primary');
		expect(needed.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(needed.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('Nötig: neue oder geänderte Migration.');
	});

	it('asks before the restart, warns about other tabs, then follows it until the server is back', async () => {
		let health: (up: boolean) => void = () => undefined;
		const { data, flags } = await show({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						health = resolve;
					})
			),
			status: vi
				.fn()
				.mockResolvedValueOnce(ok(overview()))
				.mockResolvedValue(ok(overview({ pid: 5000, startedUtc: '2026-09-30T09:00:00Z' })))
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }));
		const dialog = screen.getByRole('dialog', { name: 'becauseyoulovejira jetzt neu starten?' });
		expect(within(dialog).getByText(/Speichere vorher Eingaben in anderen Tabs/)).toBeTruthy();
		expect(data.act).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Neu starten' }));
		await vi.waitFor(() => expect(data.act).toHaveBeenCalledWith('restart', expect.anything()));
		await vi.waitFor(() => expect(screen.getByText('Neustart läuft …')).toBeTruthy());
		expect(screen.getByText(/Der Server wird geordnet beendet\./)).toBeTruthy();
		const button = screen.getByRole('button', { name: 'Jetzt neu starten' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(button.getAttribute('aria-busy')).toBe('true');

		health(false);
		await vi.waitFor(() => expect(screen.getByText(/Der Server startet wieder\./)).toBeTruthy());
		await vi.waitFor(() => expect(data.health).toHaveBeenCalledTimes(2));
		health(true);
		await vi.waitFor(() => expect(screen.queryByText('Neustart läuft …')).toBeNull());
		expect(screen.getByText('Läuft seit 30.09.2026 11:00')).toBeTruthy();
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'becauseyoulovejira wurde neu gestartet.' })
		);
		expect(button.getAttribute('aria-disabled')).toBe('false');
	});

	it('names a restart after which the app does not answer as a real error', async () => {
		await show({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => false)
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Neu starten' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/Die App antwortet nach dem Neustart nicht/);
		expect(alert.textContent).toMatch(/start\.bat im Ordner app/);
	});

	it('restarts the mail helper and switches the autostart, one action at a time', async () => {
		let release: () => void = () => undefined;
		const { data } = await show({
			act: vi.fn(
				(action) =>
					new Promise<SystemAnswer<SystemOverview>>((resolve) => {
						release = () =>
							resolve(ok(overview({ autostart: action === 'autostart-on' ? 'on' : 'off' }, true)));
					})
			)
		});
		const toggle = screen.getByRole('switch', {
			name: 'Beim Anmelden an Windows starten'
		}) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		await fireEvent.click(toggle);
		expect(data.act).toHaveBeenCalledWith('autostart-on', expect.anything());
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Mail-Helfer neu starten' }));
		expect(data.act).toHaveBeenCalledTimes(1);
		release();
		await vi.waitFor(() => expect(toggle.getAttribute('aria-disabled')).toBe('false'));
		expect(toggle.checked).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Mail-Helfer neu starten' }));
		expect(data.act).toHaveBeenLastCalledWith('mail-restart', expect.anything());
		release();
		await vi.waitFor(() => expect(screen.getByText('Läuft')).toBeTruthy());
	});

	it('shows a refused action next to the actions', async () => {
		await show({ act: vi.fn(async () => ({ kind: 'denied', reason: 'rate' }) as const) });
		await fireEvent.click(screen.getByRole('button', { name: 'Mail-Helfer neu starten' }));
		const actions = within(screen.getByRole('region', { name: 'Aktionen' }));
		await vi.waitFor(() => expect(actions.getByText('Zu viele Anfragen')).toBeTruthy());
	});

	it('lists the checks of "Umgebung prüfen" with their level, red only for errors', async () => {
		await show({
			doctor: vi.fn(async () =>
				ok({
					ok: false,
					checks: [
						{ name: 'web', level: 'ok' as const, text: 'Oberfläche gebaut (pb_public)' },
						{ name: 'disk', level: 'error' as const, text: '80 MB frei auf C:\\' },
						{
							name: 'autostart',
							level: 'warning' as const,
							text: 'Autostart zeigt auf einen anderen Ordner'
						}
					]
				})
			)
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Umgebung prüfen' }));
		const list = await screen.findByRole('list', { name: 'Ergebnis der Prüfung' });
		const items = within(list).getAllByRole('listitem');
		const expected = [
			['In Ordnung', 'Oberfläche gebaut (pb_public)', 'brand'],
			['Fehler', '80 MB frei auf C:\\', 'danger'],
			['Warnung', 'Autostart zeigt auf einen anderen Ordner', 'neutral']
		];
		expect(items).toHaveLength(expected.length);
		expected.forEach(([level, text, tone], index) => {
			const item = within(items[index] as HTMLElement);
			expect(item.getByText(level as string)).toBeTruthy();
			expect(item.getByText(text as string)).toBeTruthy();
			expect(items[index]?.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe(tone);
		});
		expect(screen.getByText('1 Fehler gefunden.')).toBeTruthy();
	});

	it('shows the logs one at a time, as text in a region the keyboard reaches, and reads them again', async () => {
		const { data } = await show({
			logs: vi.fn(async () =>
				ok({
					lines: 200,
					logs: [
						{
							name: 'server' as const,
							files: [
								{
									file: 'pocketbase.out.log',
									exists: true,
									sizeBytes: 2048,
									modifiedUtc: '2026-09-30T07:15:00Z',
									lines: ['Server started']
								},
								{
									file: 'pocketbase.err.log',
									exists: false,
									sizeBytes: 0,
									modifiedUtc: null,
									lines: []
								}
							]
						},
						{
							name: 'mail' as const,
							files: [
								{
									file: 'byl-mail.log',
									exists: true,
									sizeBytes: 10,
									modifiedUtc: null,
									lines: ['<b>eins</b>', 'Absender ***@example.com']
								}
							]
						}
					]
				})
			)
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Logs ansehen' }));
		const server = await screen.findByRole('region', { name: /pocketbase\.out\.log/ });
		expect(server.textContent).toBe('Server started');
		expect(server.getAttribute('tabindex')).toBe('0');
		expect(screen.getByText(/2 KB, geändert 30\.09\.2026 09:15/)).toBeTruthy();
		expect(screen.getByText('noch nicht vorhanden')).toBeTruthy();
		const choice = screen.getByRole('button', { name: 'Mail-Helfer' });
		await fireEvent.click(choice);
		expect(choice.getAttribute('aria-pressed')).toBe('true');
		const mail = screen.getByRole('region', { name: /byl-mail\.log/ });
		expect(mail.textContent).toBe('<b>eins</b>\nAbsender ***@example.com');
		expect(mail.querySelector('b')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
		expect(data.logs).toHaveBeenCalledTimes(2);
	});
});
