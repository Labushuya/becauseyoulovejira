// Store of the page "Einstellungen → Sicherung" (ADR-0046) with fake data: the state and its
// refusals, the target folder with its field error, the generations, the switch of the access
// data, the passphrase (checked before sending), "Jetzt sichern" and "Prüfen" with their flags, the
// question for the passphrase of a sealed backup, and the restore: check, confirmation, start and
// the way through the restart to its result (with a fake clock); one change at a time, nothing
// after the page went.

import { describe, expect, it, vi } from 'vitest';
import type { BackupAnswer } from '$lib/data/backup';
import { DataError, keepAnswerProblem, unreadableProblem } from '$lib/data/errors';
import {
	parseOverview,
	parseRestoreState,
	RESTORE_START_FAILED,
	type BackupOverview,
	type RestoreState,
	type VerifyResult
} from '$lib/domain/backup';
import { BackupStore, type BackupData } from './backup.svelte';
import type { SystemClock } from './system.svelte';

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
		verify: vi.fn(async () => ok({ overview: overview(), result: verified() })),
		restore: vi.fn(async () => ok({ since: '2026-10-01T10:00:00.000Z' })),
		restoreState: vi.fn(async () => ok({ restore: null, safety: [] })),
		...data
	};
	// A clock that moves on with every wait, so the restore follows without real time.
	let time = 0;
	const clock: SystemClock = {
		now: () => time,
		wait: async (ms) => {
			time += ms;
		}
	};
	return { store: new BackupStore(full, session, flags, clock), data: full, flags, session };
}

/** A state of a restore as the route answers it. */
function restoreAt(
	at: string,
	phase: string,
	overrides: Record<string, unknown> = {}
): RestoreState {
	const parsed = parseRestoreState({
		at,
		phase,
		running: ['started', 'checking', 'stopping', 'restoring', 'starting'].includes(phase),
		name: 'byl-20261001-080000.zip',
		source: 'local',
		ok: phase === 'done',
		reason: '',
		safety: phase === 'done' ? 'pb_data.vor-wiederherstellung-20261001-100005' : '',
		credentials: { mode: 'missing', written: [], failed: false },
		config: 'kept',
		...overrides
	});
	if (parsed === null) throw new Error('not a state');
	return parsed;
}

function verified(overrides: Partial<VerifyResult> = {}): VerifyResult {
	return {
		ok: true,
		reason: '',
		encrypted: true,
		createdUtc: '2026-10-01T10:00:00Z',
		variables: [],
		counts: { tickets: 12, users: 1 },
		files: { expected: 3, missing: 0, examples: [] },
		...overrides
	};
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
		expect(owner.store.message?.title).toBe('Nur für den Verwalter der App');

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
			text: new DataError('network').message,
			problem: expect.objectContaining({
				outcome: expect.objectContaining({ result: 'network' })
			})
		});
		// A refusal of the route has no "Details" (FP-3b).
		expect(owner.store.message?.problem).toBeUndefined();
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
		// The copy that failed is a failure the server reports, with "Details" (FP-3b, R-B3).
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'error',
			title: 'Gesichert, aber nicht im Zielverzeichnis.',
			description: 'Das Zielverzeichnis war nicht erreichbar.',
			problem: expect.objectContaining({
				intent: 'Jetzt sichern',
				outcome: expect.objectContaining({ result: 'reported', code: 'unreachable' }),
				request: { method: 'POST', path: '/api/byl/backup/run' }
			})
		});
		await store.runNow();
		// The failure the server reports has "Details" (FP-3b).
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'error',
			title: 'Die Sicherung ist gescheitert.',
			description: 'try again later',
			problem: expect.objectContaining({
				intent: 'Jetzt sichern',
				outcome: expect.objectContaining({ result: 'reported', message: 'try again later' }),
				request: { method: 'POST', path: '/api/byl/backup/run' }
			})
		});
	});

	// BYL-E6-2441
	it('gives a failed copy into the target an entry, a missing setting none (FP-3b, R-B3)', async () => {
		const reasons = [
			'space',
			'not-writable',
			'helper',
			'failed',
			'passphrase-unreadable',
			'no-target',
			'no-passphrase'
		];
		const { store, flags } = setup({
			run: vi.fn(async () =>
				ok({
					overview: overview(),
					result: {
						backup: 'byl-3.zip',
						backupError: '',
						export: { ok: false, reason: reasons.shift() ?? '', file: '' }
					}
				})
			)
		});
		await store.load();
		for (const code of ['space', 'not-writable', 'helper', 'failed', 'passphrase-unreadable']) {
			await store.runNow();
			expect(flags.show, code).toHaveBeenLastCalledWith(
				expect.objectContaining({
					tone: 'error',
					title: 'Gesichert, aber nicht im Zielverzeichnis.',
					problem: expect.objectContaining({
						outcome: expect.objectContaining({ result: 'reported', code })
					})
				})
			);
		}
		await store.runNow();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'info',
			title: 'Gesichert, aber nicht im Zielverzeichnis.',
			description: 'Es ist kein Zielverzeichnis eingestellt.'
		});
		await store.runNow();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'info',
			title: 'Gesichert, aber nicht im Zielverzeichnis.',
			description: 'Es ist keine Passphrase festgelegt.'
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

	it('checks a backup and names what came out in a flag', async () => {
		type VerifyAnswer = Awaited<ReturnType<BackupData['verify']>>;
		let release: (value: VerifyAnswer) => void = () => undefined;
		const { store, data, flags } = setup({
			verify: vi.fn(() => new Promise<VerifyAnswer>((done) => (release = done)))
		});
		await store.load();
		const checking = store.verify({ source: 'local', name: 'byl-20261001-100000.zip' });
		expect(store.busy).toBe('verify');
		expect(store.verifying).toEqual({
			source: 'local',
			name: 'byl-20261001-100000.zip',
			restore: false
		});
		release(ok({ overview: overview(), result: verified({ encrypted: false }) }));
		await checking;
		expect(store.verifying).toBeNull();
		expect(data.verify).toHaveBeenCalledWith(
			{ source: 'local', name: 'byl-20261001-100000.zip' },
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'success',
			title: 'Sicherung geprüft: in Ordnung.',
			description: '12 Tickets, 3 Originaldateien.'
		});

		data.verify = vi.fn(async () =>
			ok({
				overview: overview(),
				result: verified({
					ok: false,
					reason: 'files',
					files: { expected: 3, missing: 1, examples: ['inbox_items/abc'] }
				})
			})
		);
		await store.verify({ source: 'local', name: 'byl-20261001-100000.zip' });
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'error',
			title: 'Die Prüfung der Sicherung ist gescheitert.',
			description: 'In der Sicherung fehlen Originaldateien.',
			problem: expect.objectContaining({
				intent: 'Sicherung prüfen',
				outcome: expect.objectContaining({ result: 'reported', code: 'files' }),
				request: { method: 'POST', path: '/api/byl/backup/verify' }
			})
		});
		expect(store.passphraseRequest).toBeNull();
	});

	it('asks for the passphrase of a sealed backup the stored one does not open, and sends it once', async () => {
		const sealed = { source: 'target', name: 'byl-20260101-100000.tar.age' } as const;
		const verify = vi
			.fn<BackupData['verify']>()
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ ok: false, reason: 'passphrase' }) })
			)
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ ok: false, reason: 'passphrase' }) })
			)
			.mockResolvedValueOnce(ok({ overview: overview(), result: verified() }));
		const { store, flags } = setup({ verify });
		await store.load();
		await store.verify(sealed);
		expect(store.passphraseRequest).toEqual({ ...sealed, reason: 'passphrase' });
		expect(flags.show).not.toHaveBeenCalled();

		await store.verify(sealed, 'die alte Passphrase');
		expect(verify).toHaveBeenLastCalledWith(
			{ ...sealed, passphrase: 'die alte Passphrase' },
			expect.anything()
		);
		expect(store.passphraseRequest).toEqual({ ...sealed, reason: 'passphrase' });

		await store.verify(sealed, 'die richtige Passphrase');
		expect(store.passphraseRequest).toBeNull();
		expect(flags.show).toHaveBeenLastCalledWith(
			expect.objectContaining({ tone: 'success', title: 'Sicherung geprüft: in Ordnung.' })
		);

		verify.mockResolvedValueOnce(
			ok({ overview: overview(), result: verified({ ok: false, reason: 'no-passphrase' }) })
		);
		await store.verify(sealed);
		expect(store.passphraseRequest?.reason).toBe('no-passphrase');
		store.cancelPassphraseRequest();
		expect(store.passphraseRequest).toBeNull();
	});

	it('names a refused check next to the actions', async () => {
		const { store } = setup({
			verify: vi.fn(async () => ({ kind: 'denied', reason: 'rate' }) as const)
		});
		await store.load();
		await store.verify({ source: 'local', name: 'x.zip' });
		expect(store.actionMessage?.tone).toBe('warning');
		expect(store.verifying).toBeNull();
		expect(store.busy).toBeNull();
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

describe('BackupStore: restore (BK-3)', () => {
	const local = {
		source: 'local',
		name: 'byl-20261001-080000.zip',
		at: '2026-10-01T08:00:00.000Z'
	} as const;
	const sealed = {
		source: 'target',
		name: 'byl-20261001-080000.tar.age',
		at: '2026-10-01T08:00:00.000Z'
	} as const;

	it('checks the backup first and asks for the confirmation only when it is in order', async () => {
		const verify = vi
			.fn<BackupData['verify']>()
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ ok: false, reason: 'integrity' }) })
			)
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ variables: ['BYL_A'] }) })
			);
		const { store, flags } = setup({ verify });
		await store.load();
		await store.prepareRestore(local);
		expect(store.restoreDraft).toBeNull();
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'error',
			title: 'Diese Sicherung lässt sich nicht wiederherstellen.',
			description: 'Die Datenbank in der Sicherung ist beschädigt.',
			problem: expect.objectContaining({
				intent: 'Sicherung wiederherstellen',
				outcome: expect.objectContaining({ result: 'reported', code: 'integrity' }),
				request: { method: 'POST', path: '/api/byl/backup/verify' }
			})
		});
		await store.prepareRestore(local);
		expect(store.restoreDraft).toMatchObject({
			source: 'local',
			name: local.name,
			at: local.at,
			result: { variables: ['BYL_A'] }
		});
		store.cancelRestore();
		expect(store.restoreDraft).toBeNull();
	});

	it('asks for the passphrase of an older sealed backup and sends it with the restore once', async () => {
		const verify = vi
			.fn<BackupData['verify']>()
			.mockResolvedValueOnce(
				ok({ overview: overview(), result: verified({ ok: false, reason: 'passphrase' }) })
			)
			.mockResolvedValueOnce(ok({ overview: overview(), result: verified() }));
		const restore = vi.fn<BackupData['restore']>(
			async () => ({ kind: 'invalid', problem: 'missing' }) as const
		);
		const { store } = setup({ verify, restore });
		await store.load();
		await store.prepareRestore(sealed);
		expect(store.passphraseRequest).toEqual({
			source: 'target',
			name: sealed.name,
			reason: 'passphrase',
			restoreAt: sealed.at
		});
		await store.answerPassphrase('die alte Passphrase');
		expect(verify).toHaveBeenLastCalledWith(
			{ source: 'target', name: sealed.name, passphrase: 'die alte Passphrase' },
			expect.anything()
		);
		expect(store.restoreDraft).toMatchObject({ source: 'target', name: sealed.name });
		await store.restore('all', 'WIEDERHERSTELLEN');
		expect(restore).toHaveBeenCalledWith(
			{
				source: 'target',
				name: sealed.name,
				credentials: 'all',
				confirm: 'WIEDERHERSTELLEN',
				passphrase: 'die alte Passphrase'
			},
			expect.anything()
		);
		// The control script found no such backup any more: named next to the actions.
		expect(store.actionMessage).toEqual({
			tone: 'error',
			message: {
				title: 'Wiederherstellung nicht möglich',
				text: 'Die Sicherung gibt es nicht (mehr).'
			}
		});
		expect(JSON.stringify(store)).not.toContain('die alte Passphrase');
	});

	it('wants the word, then follows the restore through the restart of the app to its result', async () => {
		// An older restore first (before the time "since" of the start), then this one.
		const states = [
			ok({ restore: restoreAt('2026-10-01T09:00:00.000Z', 'done'), safety: [] }),
			ok({ restore: restoreAt('2026-10-01T10:00:05.000Z', 'checking'), safety: [] })
		];
		const restoreState = vi.fn<BackupData['restoreState']>(async () => {
			const next = states.shift();
			if (next !== undefined) return next;
			if (restoreState.mock.calls.length === 3) throw new DataError('network');
			return ok({
				restore: restoreAt('2026-10-01T10:01:00.000Z', 'done', {
					credentials: { mode: 'missing', written: ['BYL_A'], failed: false }
				}),
				safety: []
			});
		});
		const { store, data, flags } = setup({
			verify: vi.fn(async () => ok({ overview: overview(), result: verified() })),
			restoreState
		});
		await store.load();
		await store.prepareRestore(local);
		await store.restore('missing', 'wiederherstellen');
		expect(store.restoreProblem).toBe('confirm');
		expect(data.restore).not.toHaveBeenCalled();

		const running = store.restore('missing', ' WIEDERHERSTELLEN ');
		expect(store.busy).toBe('restore');
		await running;
		expect(data.restore).toHaveBeenCalledWith(
			{ source: 'local', name: local.name, credentials: 'missing', confirm: 'WIEDERHERSTELLEN' },
			expect.anything()
		);
		expect(restoreState).toHaveBeenCalledTimes(4);
		expect(store.restoreDraft).toBeNull();
		expect(store.restoreProgress).toBeNull();
		expect(store.busy).toBeNull();
		// The overview of the restored app, and the result as a flag.
		expect(data.overview).toHaveBeenCalledTimes(2);
		expect(flags.show).toHaveBeenLastCalledWith({
			tone: 'success',
			title: 'Wiederhergestellt.',
			description:
				'Die Daten sind auf dem Stand von byl-20261001-080000.zip. Die bisherigen liegen 7 Tage im Ordner app als pb_data.vor-wiederherstellung-20261001-100005. Zugangsdaten zurückgeschrieben: BYL_A.'
		});
	});

	it('names a restore that went back, in red', async () => {
		const { store } = setup({
			restoreState: vi.fn(async () =>
				ok({
					restore: restoreAt('2026-10-01T10:02:00.000Z', 'rolled-back', { reason: 'start' }),
					safety: []
				})
			)
		});
		await store.load();
		await store.prepareRestore(local);
		await store.restore('none', 'WIEDERHERSTELLEN');
		expect(store.actionMessage).toEqual({
			tone: 'error',
			message: {
				title: 'Wiederherstellung zurückgenommen',
				text: RESTORE_START_FAILED,
				problem: expect.objectContaining({
					intent: 'Sicherung wiederherstellen',
					outcome: expect.objectContaining({
						result: 'reported',
						code: 'start',
						message: RESTORE_START_FAILED
					}),
					request: { method: 'GET', path: '/api/byl/backup/restore' }
				})
			}
		});
	});

	// BYL-E6-2433
	it('names a cancelled restore and a missing passphrase without "Details" (FP-3b)', async () => {
		const { store, flags } = setup({
			verify: vi
				.fn<BackupData['verify']>()
				.mockResolvedValueOnce(
					ok({ overview: overview(), result: verified({ ok: false, reason: 'no-passphrase' }) })
				)
				.mockResolvedValue(ok({ overview: overview(), result: verified() })),
			restoreState: vi.fn(async () =>
				ok({
					restore: restoreAt('2026-10-01T10:02:00.000Z', 'failed', { reason: 'cancel' }),
					safety: []
				})
			)
		});
		await store.load();
		// A backup here has no passphrase to ask for: the flag says it, without an entry.
		await store.verify({ source: 'local', name: 'x.zip' });
		expect(flags.show).toHaveBeenLastCalledWith(
			expect.objectContaining({ tone: 'error', problem: null })
		);
		await store.prepareRestore(local);
		await store.restore('none', 'WIEDERHERSTELLEN');
		expect(store.actionMessage).toEqual({
			tone: 'error',
			message: {
				title: 'Wiederherstellung nicht möglich',
				text: 'Abgebrochen; nichts wurde geändert.'
			}
		});
	});

	// BYL-E6-2440
	it('gives a start of a restore that failed "Details", a refused input or precondition none (FP-3b, R-A2)', async () => {
		const restore = vi.fn<BackupData['restore']>();
		const { store } = setup({ restore });
		await store.load();
		for (const problem of ['detach', 'input', 'failed', 'neu-unbekannt']) {
			restore.mockResolvedValueOnce({ kind: 'invalid', problem });
			await store.prepareRestore(local);
			await store.restore('none', 'WIEDERHERSTELLEN');
			expect(store.actionMessage?.tone, problem).toBe('error');
			expect(store.actionMessage?.message.problem, problem).toMatchObject({
				intent: 'Sicherung wiederherstellen',
				outcome: { result: 'reported', code: problem },
				request: { method: 'POST', path: '/api/byl/backup/restore' }
			});
		}
		// An unknown problem keeps the words of a failed run.
		expect(store.actionMessage?.message.text).toBe('Die Prüfung ließ sich nicht ausführen.');
		for (const problem of ['name', 'passphrase', 'missing', 'unreachable']) {
			restore.mockResolvedValueOnce({ kind: 'invalid', problem });
			await store.prepareRestore(local);
			await store.restore('none', 'WIEDERHERSTELLEN');
			expect(store.actionMessage?.message.title, problem).toBe('Wiederherstellung nicht möglich');
			expect(store.actionMessage?.message.problem, problem).toBeUndefined();
		}
		// The word and the choice stay at their fields, without an entry.
		restore.mockResolvedValueOnce({ kind: 'invalid', problem: 'credentials' });
		await store.prepareRestore(local);
		await store.restore('none', 'WIEDERHERSTELLEN');
		expect(store.restoreProblem).toBe('credentials');
	});

	// BYL-E6-2442
	it('names a restore whose state answered 500 for 15 minutes no "Keine Verbindung" (FP-3b, R-B4)', async () => {
		const running = ok({ restore: restoreAt('2026-10-01T10:00:05.000Z', 'restoring'), safety: [] });
		const { store } = setup({
			restoreState: vi
				.fn<BackupData['restoreState']>()
				.mockResolvedValueOnce(running)
				.mockRejectedValue(new DataError('server', { status: 500 }))
		});
		await store.load();
		await store.prepareRestore(local);
		await store.restore('none', 'WIEDERHERSTELLEN');
		expect(store.actionMessage?.message.title).toBe('Kein Ergebnis der Wiederherstellung');
		expect(store.actionMessage?.message.problem).toMatchObject({
			intent: 'Sicherung wiederherstellen',
			outcome: {
				result: 'reported',
				message: 'Nach 15 Minuten kam kein Ergebnis der Wiederherstellung.'
			},
			request: { method: 'GET', path: '/api/byl/backup/restore' }
		});
		expect(store.actionMessage?.message.problem?.outcome.result).not.toBe('network');
	});

	// BYL-E6-2433
	it('names a restore without a result after 15 minutes with "Details" (FP-3b)', async () => {
		const running = ok({ restore: restoreAt('2026-10-01T10:00:05.000Z', 'restoring'), safety: [] });
		const away = setup({
			restoreState: vi
				.fn<BackupData['restoreState']>()
				.mockResolvedValueOnce(running)
				.mockRejectedValue(new DataError('network'))
		});
		await away.store.load();
		await away.store.prepareRestore(local);
		await away.store.restore('none', 'WIEDERHERSTELLEN');
		expect(away.store.actionMessage?.message.title).toBe('Kein Ergebnis der Wiederherstellung');
		expect(away.store.actionMessage?.message.problem).toMatchObject({
			intent: 'Sicherung wiederherstellen',
			outcome: { result: 'network' },
			request: { method: 'GET', path: '/api/byl/backup/restore' }
		});

		const stuck = setup({ restoreState: vi.fn(async () => running) });
		await stuck.store.load();
		await stuck.store.prepareRestore(local);
		await stuck.store.restore('none', 'WIEDERHERSTELLEN');
		expect(stuck.store.actionMessage?.message.problem).toMatchObject({
			intent: 'Sicherung wiederherstellen',
			outcome: {
				result: 'reported',
				message: 'Nach 15 Minuten kam kein Ergebnis der Wiederherstellung.'
			}
		});
	});

	// BYL-E6-2433
	it('names the check before a restore „Sicherung wiederherstellen“ in "Details" (FP-3b)', async () => {
		const refused = setup({
			verify: vi.fn(async () =>
				keepAnswerProblem<Awaited<ReturnType<BackupData['verify']>>>(
					{ kind: 'denied', reason: 'script' },
					unreadableProblem('POST', '/api/byl/backup/verify')
				)
			)
		});
		await refused.store.load();
		await refused.store.prepareRestore(local);
		expect(refused.store.actionMessage?.tone).toBe('error');
		expect(refused.store.actionMessage?.message.problem).toMatchObject({
			intent: 'Sicherung wiederherstellen',
			outcome: { result: 'answer' },
			request: { method: 'POST', path: '/api/byl/backup/verify' }
		});

		const offline = setup({
			verify: vi.fn(async () => Promise.reject(new DataError('network')))
		});
		await offline.store.load();
		await offline.store.prepareRestore(local);
		expect(offline.store.actionMessage?.message.problem).toMatchObject({
			intent: 'Sicherung wiederherstellen',
			outcome: { result: 'network' }
		});
		// "Prüfen" alone keeps the intent of its route.
		await offline.store.verify({ source: 'local', name: 'x.zip' });
		expect(offline.store.actionMessage?.message.problem?.intent).not.toBe(
			'Sicherung wiederherstellen'
		);
	});

	it('follows a restore that runs when the page opens, and signs out when the restored app does not know the account', async () => {
		const running = restoreAt('2026-10-01T10:00:00.000Z', 'stopping');
		const { store, session } = setup({
			overview: vi.fn(async () =>
				ok(overview({ restore: { ...running, at: running.at, running: true } }))
			),
			restoreState: vi.fn(async () => Promise.reject(new DataError('session')))
		});
		await store.load();
		await vi.waitFor(() => expect(session.logout).toHaveBeenCalled());
		expect(store.busy).toBeNull();
	});
});
