// Page "Einstellungen → Sicherung" (ADR-0046) in jsdom with the real store and fake data: the hint
// for a server that is not on Windows, the state and its warnings (red only for real errors), "Jetzt
// sichern", the target folder with its field error, the passphrase checked before sending and
// emptied after saving, the switch of the access data with its hint about the environment
// variables, the generations, the lists of backups, the last check, "Jetzt prüfen", "Prüfen", the
// passphrase asked for below a sealed backup, and the restore: its confirmation below the backup,
// the running restore, the last one and the safety copies.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { BackupAnswer } from '$lib/data/backup';
import { parseOverview, type BackupOverview, type VerifyResult } from '$lib/domain/backup';
import { BackupStore, type BackupData } from '$lib/stores/backup.svelte';
import type { SystemClock } from '$lib/stores/system.svelte';
import BackupView from './BackupView.svelte';

/** A clock that moves on with every wait, so a restore is followed without real time. */
function fakeClock(): SystemClock {
	let time = 0;
	return {
		now: () => time,
		wait: async (ms) => {
			time += ms;
		}
	};
}

function overview(overrides: Record<string, unknown> = {}): BackupOverview {
	const parsed = parseOverview({
		appDir: 'C:\\Apps\\app',
		settings: { target: 'E:\\Sicherung', daily: 7, weekly: 4, monthly: 6, credentials: true },
		passphrase: 'set',
		helper: true,
		variables: ['BYL_TELEGRAM_TOKEN', 'BYL_WEBDE_PASSWORD'],
		target: {
			path: 'E:\\Sicherung',
			reachable: true,
			problem: null,
			freeBytes: 5 * 1024 ** 3,
			sameDrive: false
		},
		local: [
			{
				name: 'byl-20261001-100000.zip',
				at: '2026-10-01T10:00:00.000Z',
				bytes: 2 * 1024 ** 2,
				ours: true
			},
			{ name: 'handarbeit.zip', at: '2026-09-01T10:00:00.000Z', bytes: 1024, ours: false }
		],
		sealed: [
			{ name: 'byl-20261001-100000.tar.age', at: '2026-10-01T10:00:00.000Z', bytes: 3 * 1024 ** 2 }
		],
		last: {
			backup: {
				at: '2026-10-01T10:00:00.000Z',
				name: 'byl-20261001-100000.zip',
				bytes: 2 * 1024 ** 2
			},
			backupError: null,
			export: null,
			exportProblem: null
		},
		nextBackupAt: '2026-10-02T10:00:00.000Z',
		warnings: [],
		...overrides
	});
	if (parsed === null) throw new Error('not an overview');
	return parsed;
}

const ok = <T>(value: T): BackupAnswer<T> => ({ kind: 'ok', value });

function verified(overrides: Partial<VerifyResult> = {}): VerifyResult {
	return {
		ok: true,
		reason: '',
		encrypted: true,
		createdUtc: '2026-10-01T10:00:00Z',
		variables: [],
		counts: { tickets: 12 },
		files: { expected: 3, missing: 0, examples: [] },
		...overrides
	};
}

async function show(
	data: Partial<BackupData> = {},
	platform: 'windows' | 'linux' = 'windows',
	first = overview()
) {
	const full: BackupData = {
		overview: vi.fn(async () => ok(first)),
		run: vi.fn(async () =>
			ok({ overview: first, result: { backup: 'byl-x.zip', backupError: '', export: null } })
		),
		saveSettings: vi.fn(async (settings) =>
			ok(overview({ settings: { ...settings, target: settings.target || null } }))
		),
		savePassphrase: vi.fn(async () => ok(first)),
		verify: vi.fn(async () => ok({ overview: first, result: verified() })),
		restore: vi.fn(async () => ok({ since: '2026-10-01T11:00:00.000Z' })),
		restoreState: vi.fn(async () => ok({ restore: null, safety: [] })),
		...data
	};
	const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
	const store = new BackupStore(
		full,
		{ ensureValid: () => true, logout: vi.fn() },
		flags,
		fakeClock()
	);
	if (platform === 'windows') await store.load();
	render(BackupView, { props: { store, platform } });
	await tick();
	return { store, data: full, flags };
}

describe('page Sicherung', () => {
	it('shows only a hint for a server that is not on Windows', async () => {
		const { data } = await show({}, 'linux');
		expect(screen.getByText('Nur für einen Server unter Windows')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Jetzt sichern' })).toBeNull();
		expect(data.overview).not.toHaveBeenCalled();
	});

	it('shows the state of the backups and the backups here and in the target', async () => {
		await show();
		const state = within(screen.getByRole('region', { name: 'Zustand' }));
		expect(state.getByText('01.10.2026 12:00 · 2,0 MB')).toBeTruthy();
		expect(state.getByText('01.10.2026 12:00 · 3,0 MB')).toBeTruthy();
		expect(state.getByText('etwa 02.10.2026 12:00')).toBeTruthy();
		expect(state.getByText('7 tägliche, 4 wöchentliche, 6 monatliche')).toBeTruthy();
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		expect(list.getByText('Generation')).toBeTruthy();
		expect(list.getByText('Andere Sicherung (bleibt)')).toBeTruthy();
		expect(list.getByText('byl-20261001-100000.tar.age')).toBeTruthy();
	});

	it('shows warnings without red and real errors in red', async () => {
		await show(
			{},
			'windows',
			overview({
				warnings: [
					{
						code: 'target-lag',
						tone: 'warning',
						since: '2026-09-28T10:00:00.000Z',
						reason: 'unreachable'
					},
					{ code: 'export-failed', tone: 'error', since: null, reason: 'helper' }
				]
			})
		);
		const lag = screen
			.getByText('Das Zielverzeichnis ist länger nicht aktuell')
			.closest('[data-tone]');
		expect(lag?.getAttribute('data-tone')).toBe('warning');
		const failed = screen
			.getByText('Die Kopie ins Zielverzeichnis ist gescheitert')
			.closest('[data-tone]');
		expect(failed?.getAttribute('data-tone')).toBe('error');
	});

	it('backs up now; the other changes wait meanwhile', async () => {
		let release: () => void = () => undefined;
		const { data } = await show({
			run: vi.fn(
				() =>
					new Promise<Awaited<ReturnType<BackupData['run']>>>((done) => {
						release = () =>
							done(
								ok({ overview: overview(), result: { backup: 'b', backupError: '', export: null } })
							);
					})
			)
		});
		const button = screen.getByRole('button', { name: 'Jetzt sichern' });
		await fireEvent.click(button);
		expect(button.getAttribute('aria-busy')).toBe('true');
		const save = screen.getByRole('button', { name: 'Zielverzeichnis speichern' });
		expect(save.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(save);
		expect(data.saveSettings).not.toHaveBeenCalled();
		release();
		await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
	});

	it('saves the target folder and shows a refusal at the field', async () => {
		const { data } = await show({
			saveSettings: vi.fn(async () => ({ kind: 'invalid', problem: 'missing' }) as const)
		});
		const field = screen.getByLabelText(
			'Ordner für die verschlüsselten Sicherungen'
		) as HTMLInputElement;
		expect(field.value).toBe('E:\\Sicherung');
		await fireEvent.input(field, { target: { value: 'F:\\USB\\Sicherung' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Zielverzeichnis speichern' }));
		await vi.waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
		expect(data.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ target: 'F:\\USB\\Sicherung' }),
			expect.anything()
		);
		const error = document.getElementById(
			field.getAttribute('aria-describedby')?.split(' ')[0] ?? ''
		);
		expect(error?.textContent).toContain('Den Ordner gibt es nicht');
	});

	it('checks the passphrase before sending and empties the fields after saving', async () => {
		const { data } = await show();
		expect(
			screen.getByText(
				'Bewahre die Passphrase in deinem Passwort-Manager auf – ohne sie lässt sich die Sicherung nicht öffnen.'
			)
		).toBeTruthy();
		const first = screen.getByLabelText('Neue Passphrase') as HTMLInputElement;
		const second = screen.getByLabelText('Passphrase wiederholen') as HTMLInputElement;
		expect(first.type).toBe('password');
		await fireEvent.input(first, { target: { value: 'richtig Pferd Batterie' } });
		await fireEvent.input(second, { target: { value: 'richtig Pferd' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Passphrase ändern' }));
		expect(data.savePassphrase).not.toHaveBeenCalled();
		expect(second.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Die beiden Eingaben stimmen nicht überein.')).toBeTruthy();

		await fireEvent.input(second, { target: { value: 'richtig Pferd Batterie' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Passphrase ändern' }));
		await vi.waitFor(() => expect(first.value).toBe(''));
		expect(second.value).toBe('');
		expect(data.savePassphrase).toHaveBeenCalledWith(
			'richtig Pferd Batterie',
			'richtig Pferd Batterie',
			expect.anything()
		);
	});

	it('switches the access data and says where they come from', async () => {
		const { data } = await show();
		const toggle = screen.getByRole('switch', {
			name: 'Zugangsdaten mitsichern'
		}) as HTMLInputElement;
		expect(toggle.checked).toBe(true);
		const hint = document.getElementById(toggle.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toContain('Windows-Umgebungsvariablen BYL_*');
		expect(screen.getByText('BYL_WEBDE_PASSWORD')).toBeTruthy();
		await fireEvent.click(toggle);
		await vi.waitFor(() =>
			expect(data.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({ credentials: false }),
				expect.anything()
			)
		);
	});

	it('checks the generations before saving', async () => {
		const { data } = await show();
		const daily = screen.getByLabelText('Tägliche (1–30)') as HTMLInputElement;
		await fireEvent.input(daily, { target: { value: '0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Aufbewahrung speichern' }));
		expect(data.saveSettings).not.toHaveBeenCalled();
		expect(daily.getAttribute('aria-invalid')).toBe('true');
		await fireEvent.input(daily, { target: { value: '3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Aufbewahrung speichern' }));
		await vi.waitFor(() =>
			expect(data.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({ daily: 3, weekly: 4, monthly: 6 }),
				expect.anything()
			)
		);
	});

	it('shows the last check and checks the newest backup in the target now', async () => {
		const { data } = await show(
			{},
			'windows',
			overview({
				last: {
					backup: null,
					backupError: null,
					export: null,
					exportProblem: null,
					verify: {
						at: '2026-10-01T11:00:00.000Z',
						name: 'byl-20261001-100000.tar.age',
						source: 'target',
						ok: true,
						reason: '',
						counts: { tickets: 12 },
						files: { expected: 3, missing: 0, examples: [] }
					}
				}
			})
		);
		const state = within(screen.getByRole('region', { name: 'Zustand' }));
		expect(
			state.getByText(
				'01.10.2026 13:00 · Sicherung im Zielverzeichnis in Ordnung (12 Tickets, 3 Originaldateien)'
			)
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }));
		await vi.waitFor(() =>
			expect(data.verify).toHaveBeenCalledWith(
				{ source: 'target', name: 'byl-20261001-100000.tar.age' },
				expect.anything()
			)
		);
	});

	it('checks a single backup and asks below a sealed one for its passphrase', async () => {
		const verify = vi
			.fn<BackupData['verify']>()
			.mockResolvedValueOnce(ok({ overview: overview(), result: verified({ encrypted: false }) }))
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ ok: false, reason: 'passphrase' }) })
			)
			.mockResolvedValueOnce(ok({ overview: overview(), result: verified() }));
		await show({ verify });
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		await fireEvent.click(
			list.getByRole('button', { name: 'Sicherung vom 01.10.2026 12:00 im Ordner app prüfen' })
		);
		await vi.waitFor(() =>
			expect(verify).toHaveBeenLastCalledWith(
				{ source: 'local', name: 'byl-20261001-100000.zip' },
				expect.anything()
			)
		);

		const sealed = list.getByRole('button', {
			name: 'Sicherung vom 01.10.2026 12:00 im Zielverzeichnis prüfen'
		});
		await fireEvent.click(sealed);
		const field = (await list.findByLabelText('Passphrase dieser Sicherung')) as HTMLInputElement;
		expect(field.type).toBe('password');
		expect(field.getAttribute('aria-invalid')).toBe('true');
		await vi.waitFor(() => expect(document.activeElement).toBe(field));
		const message = document.getElementById(field.getAttribute('aria-describedby') ?? '');
		expect(message?.textContent).toContain('Die Passphrase passt nicht zu dieser Sicherung.');

		await fireEvent.input(field, { target: { value: 'die alte Passphrase' } });
		await fireEvent.click(list.getByRole('button', { name: 'Mit dieser Passphrase prüfen' }));
		await vi.waitFor(() => expect(list.queryByLabelText('Passphrase dieser Sicherung')).toBeNull());
		expect(verify).toHaveBeenLastCalledWith(
			{ source: 'target', name: 'byl-20261001-100000.tar.age', passphrase: 'die alte Passphrase' },
			expect.anything()
		);
	});

	it('gives the focus back to "Prüfen" when the question for the passphrase is cancelled', async () => {
		await show({
			verify: vi.fn(async () =>
				ok({ overview: overview(), result: verified({ ok: false, reason: 'no-passphrase' }) })
			)
		});
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		const sealed = list.getByRole('button', {
			name: 'Sicherung vom 01.10.2026 12:00 im Zielverzeichnis prüfen'
		});
		await fireEvent.click(sealed);
		const field = await list.findByLabelText('Passphrase dieser Sicherung');
		expect(field.getAttribute('aria-invalid')).toBeNull();
		await fireEvent.click(list.getByRole('button', { name: 'Abbrechen' }));
		await vi.waitFor(() => expect(document.activeElement).toBe(sealed));
		expect(list.queryByLabelText('Passphrase dieser Sicherung')).toBeNull();
	});

	it('names a missing helper and a target on the same drive', async () => {
		await show(
			{},
			'windows',
			overview({
				helper: false,
				target: { path: 'C:\\S', reachable: true, problem: null, freeBytes: null, sameDrive: true }
			})
		);
		expect(screen.getByText('byl-backup.exe fehlt')).toBeTruthy();
		expect(screen.getByText(/liegt auf demselben Laufwerk wie die App/)).toBeTruthy();
	});

	it('restores a backup after its check, with the choice for the access data and the word', async () => {
		const done = parseOverview({
			...JSON.parse(JSON.stringify(overview())),
			restore: {
				at: '2026-10-01T11:01:00.000Z',
				phase: 'done',
				running: false,
				name: 'byl-20261001-100000.zip',
				source: 'local',
				ok: true,
				safety: 'pb_data.vor-wiederherstellung-20261001-110030',
				credentials: { mode: 'all', written: ['BYL_NEU'], failed: false },
				config: 'kept'
			}
		});
		const { data, flags } = await show({
			verify: vi.fn(async () =>
				ok({
					overview: overview(),
					result: verified({ encrypted: false, variables: ['BYL_TELEGRAM_TOKEN', 'BYL_NEU'] })
				})
			),
			restoreState: vi.fn(async () => ok({ restore: done?.restore ?? null, safety: [] }))
		});
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		await fireEvent.click(
			list.getByRole('button', {
				name: 'Sicherung vom 01.10.2026 12:00 im Ordner app wiederherstellen …'
			})
		);
		const form = await list.findByRole('form', {
			name: 'Sicherung vom 01.10.2026 12:00 wiederherstellen'
		});
		const panel = within(form);
		expect(panel.getByText(/Auf diesem Windows-Konto fehlen: BYL_NEU\./)).toBeTruthy();
		const word = panel.getByLabelText('Zur Bestätigung WIEDERHERSTELLEN eintippen');
		await vi.waitFor(() => expect(document.activeElement).toBe(word));
		await fireEvent.input(word, { target: { value: 'wiederherstellen' } });
		await fireEvent.click(panel.getByRole('button', { name: 'Wiederherstellen' }));
		expect(data.restore).not.toHaveBeenCalled();
		expect(word.getAttribute('aria-invalid')).toBe('true');
		expect(panel.getByText('Bitte genau WIEDERHERSTELLEN eintippen.')).toBeTruthy();

		await fireEvent.click(
			panel.getByRole('radio', { name: 'Alle mit den Werten der Sicherung überschreiben' })
		);
		await fireEvent.input(word, { target: { value: 'WIEDERHERSTELLEN' } });
		await fireEvent.click(panel.getByRole('button', { name: 'Wiederherstellen' }));
		await vi.waitFor(() =>
			expect(flags.show).toHaveBeenLastCalledWith(
				expect.objectContaining({ tone: 'success', title: 'Wiederhergestellt.' })
			)
		);
		expect(data.restore).toHaveBeenCalledWith(
			{
				source: 'local',
				name: 'byl-20261001-100000.zip',
				credentials: 'all',
				confirm: 'WIEDERHERSTELLEN'
			},
			expect.anything()
		);
		expect(list.queryByRole('form')).toBeNull();
	});

	it('gives the focus back to "Wiederherstellen …" when the confirmation is cancelled', async () => {
		await show();
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		const button = list.getByRole('button', {
			name: 'Sicherung vom 01.10.2026 12:00 im Zielverzeichnis wiederherstellen …'
		});
		await fireEvent.click(button);
		const form = await list.findByRole('form');
		await fireEvent.click(within(form).getByRole('button', { name: 'Abbrechen' }));
		await vi.waitFor(() => expect(document.activeElement).toBe(button));
		expect(list.queryByRole('form')).toBeNull();
	});

	it('shows a running restore, the last restore and the safety copies', async () => {
		await show(
			{ restoreState: vi.fn(() => new Promise<never>(() => undefined)) },
			'windows',
			overview({
				restore: {
					at: '2026-10-01T10:00:00.000Z',
					phase: 'restoring',
					running: true,
					name: 'byl-20261001-100000.zip',
					source: 'local'
				},
				safety: [
					{
						name: 'pb_data.vor-wiederherstellung-20261001-095900',
						at: '2026-10-01T09:59:00.000Z',
						until: '2026-10-08T09:59:00.000Z'
					}
				]
			})
		);
		const progress = screen.getByText('Wiederherstellung läuft').closest('[data-tone]');
		expect(progress?.getAttribute('data-tone')).toBe('info');
		const state = within(screen.getByRole('region', { name: 'Zustand' }));
		expect(state.getByText('01.10.2026 12:00 · läuft')).toBeTruthy();
		const list = within(screen.getByRole('region', { name: 'Sicherungen' }));
		expect(list.getByText('pb_data.vor-wiederherstellung-20261001-095900')).toBeTruthy();
		expect(list.getByText('bis 08.10.2026 11:59')).toBeTruthy();
		// Nothing else starts while it runs.
		expect(
			screen.getByRole('button', { name: 'Jetzt sichern' }).getAttribute('aria-disabled')
		).toBe('true');
	});
});
