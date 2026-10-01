// Store of the page "Einstellungen → Sicherung" (ADR-0046) with fake data: the state and its
// refusals, the target folder with its field error, the generations, the switch of the access
// data, the passphrase (checked before sending) and "Jetzt sichern" with its flags; one change at a
// time, nothing after the page went.

import { describe, expect, it, vi } from 'vitest';
import type { BackupAnswer } from '$lib/data/backup';
import { DataError } from '$lib/data/errors';
import { parseOverview, type BackupOverview } from '$lib/domain/backup';
import { BackupStore, type BackupData } from './backup.svelte';

function overview(overrides: Record<string, unknown> = {}): BackupOverview {
	const parsed = parseOverview({
		appDir: 'C:\\Apps\\app',
		settings: { target: null, daily: 7, weekly: 4, monthly: 6, credentials: true },
		passphrase: 'missing',
		helper: true,
		variables: ['BYL_TELEGRAM_TOKEN'],
		target: null,
		local: [],
		sealed: [],
		last: { backup: null, backupError: null, export: null, exportProblem: null },
		nextBackupAt: null,
		warnings: [],
		...overrides
	});
	if (parsed === null) throw new Error('not an overview');
	return parsed;
}

const ok = <T>(value: T): BackupAnswer<T> => ({ kind: 'ok', value });

function setup(data: Partial<BackupData> = {}) {
	const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const full: BackupData = {
		overview: vi.fn(async () => ok(overview())),
		run: vi.fn(async () =>
			ok({
				overview: overview(),
				result: { backup: 'byl-20261001-100000.zip', backupError: '', export: null }
			})
		),
		saveSettings: vi.fn(async (settings) =>
			ok(overview({ settings: { ...settings, target: settings.target || null } }))
		),
		savePassphrase: vi.fn(async () => ok(overview({ passphrase: 'set' }))),
		...data
	};
	return { store: new BackupStore(full, session, flags), data: full, flags, session };
}

describe('BackupStore: state', () => {
	it('loads the state', async () => {
		const { store } = setup();
		await store.load();
		expect(store.state).toBe('ready');
		expect(store.overview?.variables).toEqual(['BYL_TELEGRAM_TOKEN']);
	});

	it('names a refusal, the missing route and a failed load', async () => {
		const owner = setup({
			overview: vi.fn(async () => ({ kind: 'denied', reason: 'owner' }) as const)
		});
		await owner.store.load();
		expect(owner.store.state).toBe('denied');
		expect(owner.store.message?.title).toBe('Nur für den Besitzer dieser Installation');

		const missing = setup({
			overview: vi.fn(async () => ({ kind: 'denied', reason: 'missing' }) as const)
		});
		await missing.store.load();
		expect(missing.store.message?.text).toContain(
			'Die Seite Sicherung ist nach dem nächsten Neustart verfügbar.'
		);

		const failed = setup({ overview: vi.fn(async () => Promise.reject(new DataError('network'))) });
		await failed.store.load();
		expect(failed.store.state).toBe('error');
		expect(failed.store.message).toEqual({
			title: 'Nicht geladen',
			text: new DataError('network').message
		});
	});
});

describe('BackupStore: changes', () => {
	it('saves the target folder with the other settings, and shows a refusal at the field', async () => {
		const { store, data, flags } = setup({
			saveSettings: vi
				.fn()
				.mockResolvedValueOnce({ kind: 'invalid', problem: 'inside-app' })
				.mockResolvedValueOnce(
					ok(
						overview({
							settings: { target: 'E:\\S', daily: 7, weekly: 4, monthly: 6, credentials: true }
						})
					)
				)
		});
		await store.load();
		expect(await store.saveTarget('  C:\\Apps\\app\\x ')).toBe(false);
		expect(data.saveSettings).toHaveBeenLastCalledWith(
			{ target: 'C:\\Apps\\app\\x', daily: 7, weekly: 4, monthly: 6, credentials: true },
			expect.anything()
		);
		expect(store.targetProblem).toBe('inside-app');
		expect(flags.show).not.toHaveBeenCalled();

		expect(await store.saveTarget('E:\\S')).toBe(true);
		expect(store.targetProblem).toBeNull();
		expect(store.overview?.settings.target).toBe('E:\\S');
		expect(flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: 'Zielverzeichnis gespeichert.'
		});
	});

	it('saves the generations and the switch of the access data', async () => {
		const { store, data, flags } = setup();
		await store.load();
		expect(await store.saveKeep({ daily: 3, weekly: 0, monthly: 12 })).toBe(true);
		expect(data.saveSettings).toHaveBeenLastCalledWith(
			{ target: '', daily: 3, weekly: 0, monthly: 12, credentials: true },
			expect.anything()
		);
		await store.setCredentials(false);
		expect(store.overview?.settings.credentials).toBe(false);
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'success',
			title: 'Zugangsdaten werden nicht mehr mitgesichert.'
		});
	});

	it('keeps the passphrase only in the call, names a refusal and a change', async () => {
		const { store, data, flags } = setup({
			savePassphrase: vi
				.fn()
				.mockResolvedValueOnce({ kind: 'invalid', problem: 'character' })
				.mockResolvedValue(ok(overview({ passphrase: 'set' })))
		});
		await store.load();
		expect(await store.savePassphrase('zwölf Zeichen\t', 'zwölf Zeichen\t')).toBe(false);
		expect(store.passphraseProblem).toBe('character');
		expect(await store.savePassphrase('zwölf Zeichen', 'zwölf Zeichen')).toBe(true);
		expect(data.savePassphrase).toHaveBeenLastCalledWith(
			'zwölf Zeichen',
			'zwölf Zeichen',
			expect.anything()
		);
		expect(store.passphraseProblem).toBeNull();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'success',
			title: 'Passphrase gespeichert.'
		});
		await store.savePassphrase('zwölf Zeichen!', 'zwölf Zeichen!');
		expect(flags.show).toHaveBeenLastCalledWith(
			expect.objectContaining({ tone: 'success', title: 'Passphrase geändert.' })
		);
		expect(JSON.stringify(store.overview)).not.toContain('zwölf');
	});

	it('runs a backup and says where it went', async () => {
		const results = [
			{
				backup: 'byl-1.zip',
				backupError: '',
				export: { ok: true, reason: '', file: 'byl-1.tar.age' }
			},
			{
				backup: 'byl-2.zip',
				backupError: '',
				export: { ok: false, reason: 'unreachable', file: '' }
			},
			{ backup: '', backupError: 'try again later', export: null }
		];
		const { store, flags } = setup({
			run: vi.fn(async () => ok({ overview: overview(), result: results.shift() ?? results[0]! }))
		});
		await store.load();
		await store.runNow();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'success',
			title: 'Gesichert.',
			description: 'Auch verschlüsselt im Zielverzeichnis.'
		});
		await store.runNow();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'info',
			title: 'Gesichert, aber nicht im Zielverzeichnis.',
			description: 'Das Zielverzeichnis war nicht erreichbar.'
		});
		await store.runNow();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'error',
			title: 'Die Sicherung ist gescheitert.',
			description: 'try again later'
		});
	});

	it('runs one change at a time and shows a refusal next to the actions', async () => {
		type RunAnswer = Awaited<ReturnType<BackupData['run']>>;
		let release: (value: RunAnswer) => void = () => undefined;
		const { store, data } = setup({
			run: vi.fn(() => new Promise<RunAnswer>((done) => (release = done))),
			saveSettings: vi.fn(async () => ({ kind: 'denied', reason: 'busy' }) as const)
		});
		await store.load();
		const running = store.runNow();
		expect(store.busy).toBe('run');
		expect(await store.saveTarget('E:\\S')).toBe(false);
		expect(data.saveSettings).not.toHaveBeenCalled();
		release(ok({ overview: overview(), result: { backup: 'b', backupError: '', export: null } }));
		await running;
		expect(store.busy).toBeNull();
		await store.saveTarget('E:\\S');
		expect(store.actionMessage?.message.title).toBe('Eine Aktion läuft gerade');
	});

	it('ends its requests when the page goes', async () => {
		const signals: AbortSignal[] = [];
		const { store } = setup({
			overview: vi.fn(async (options) => {
				signals.push(options.signal as AbortSignal);
				return ok(overview());
			})
		});
		await store.load();
		store.dispose();
		expect(signals[0]?.aborted).toBe(true);
	});
});
