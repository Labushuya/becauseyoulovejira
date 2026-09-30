// Store of the page "Einstellungen → System" (ADR-0043) with fake data and a fake clock: the
// status and its refusals, "Umgebung prüfen", the logs, the actions with their flags, and the
// restart, which waits for the server to go and come back (or to answer with a new start) and gives
// up after its time.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { SystemAnswer } from '$lib/data/system';
import { parseOverview, type SystemOverview, type SystemStatus } from '$lib/domain/system';
import {
	RESTART_POLL_MS,
	RESTART_TIMEOUT_MS,
	SystemStore,
	type SystemClock,
	type SystemData
} from './system.svelte';

function overview(status: Partial<SystemStatus> = {}, running = false): SystemOverview {
	const parsed = parseOverview({
		appDir: 'C:\\Apps\\app',
		status: {
			state: 'running',
			pid: 100,
			port: 8090,
			configuredPort: 8090,
			url: 'http://127.0.0.1:8090/',
			startedUtc: '2026-09-30T07:00:00Z',
			verdict: 'current',
			restartReasons: [],
			reload: false,
			mailHelperPid: running ? 55 : null,
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

/** Time that passes only while the store waits. */
function fakeClock(): SystemClock {
	let now = 0;
	return {
		now: () => now,
		wait: async (ms) => {
			now += ms;
		}
	};
}

function setup(data: Partial<SystemData> = {}) {
	const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const full: SystemData = {
		status: vi.fn(async () => ok(overview())),
		doctor: vi.fn(async () => ok({ ok: true, checks: [] })),
		logs: vi.fn(async () => ok({ lines: 200, logs: [] })),
		act: vi.fn(async () => ok(overview())),
		health: vi.fn(async () => true),
		...data
	};
	const store = new SystemStore(full, session, flags, fakeClock());
	return { store, data: full, flags, session };
}

describe('SystemStore: status', () => {
	it('loads the status', async () => {
		const { store } = setup();
		expect(store.state).toBe('idle');
		await store.load();
		expect(store.state).toBe('ready');
		expect(store.overview?.status.pid).toBe(100);
		expect(store.message).toBeNull();
	});

	it('shows the refusal of the route with its text', async () => {
		const { store } = setup({
			status: vi.fn(async () => ({ kind: 'denied', reason: 'owner' }) as const)
		});
		await store.load();
		expect(store.state).toBe('denied');
		expect(store.message?.title).toBe('Nur für den Besitzer dieser Installation');
	});

	it('names the restart before the route exists (404 after an update)', async () => {
		const { store } = setup({
			status: vi.fn(async () => ({ kind: 'denied', reason: 'missing' }) as const)
		});
		await store.load();
		expect(store.message?.title).toBe('Nach dem nächsten Neustart verfügbar');
		expect(store.message?.text).toMatch(
			/^Die Seite System ist nach dem nächsten Neustart verfügbar\. .*neu-starten\.bat/
		);
	});

	it('ends the session on 401 and shows other failures as an error', async () => {
		const expired = setup({
			status: vi.fn(async () => Promise.reject(new DataError('session', { status: 401 })))
		});
		await expired.store.load();
		expect(expired.session.logout).toHaveBeenCalledTimes(1);
		const offline = setup({ status: vi.fn(async () => Promise.reject(new DataError('network'))) });
		await offline.store.load();
		expect(offline.store.state).toBe('error');
		expect(offline.store.message?.text).toMatch(/Server nicht erreichbar/);
	});
});

describe('SystemStore: checks and logs', () => {
	it('runs "Umgebung prüfen" and loads the logs on request', async () => {
		const { store, data } = setup({
			doctor: vi.fn(async () =>
				ok({ ok: false, checks: [{ name: 'disk', level: 'error' as const, text: '80 MB frei' }] })
			),
			logs: vi.fn(async () => ok({ lines: 200, logs: [{ name: 'server' as const, files: [] }] }))
		});
		expect(store.doctor.state).toBe('idle');
		const running = store.runDoctor();
		expect(store.doctor.state).toBe('loading');
		await running;
		expect(store.doctor).toEqual({
			state: 'ready',
			value: { ok: false, checks: [{ name: 'disk', level: 'error', text: '80 MB frei' }] },
			message: null
		});
		await store.loadLogs();
		expect(store.logs.state).toBe('ready');
		expect(store.logs.value?.logs[0]?.name).toBe('server');
		expect(data.logs).toHaveBeenCalledTimes(1);
	});

	it('keeps the last logs when reading them again is refused', async () => {
		let calls = 0;
		const { store } = setup({
			logs: vi.fn(async () =>
				++calls === 1 ? ok({ lines: 200, logs: [] }) : ({ kind: 'denied', reason: 'rate' } as const)
			)
		});
		await store.loadLogs();
		await store.loadLogs();
		expect(store.logs.state).toBe('denied');
		expect(store.logs.value).toEqual({ lines: 200, logs: [] });
		expect(store.logs.message?.title).toBe('Zu viele Anfragen');
	});
});

describe('SystemStore: actions', () => {
	it('restarts the mail helper and says the result as a flag', async () => {
		const { store, data, flags } = setup({
			act: vi.fn(async () => ok(overview({ mailHelperPid: 55 }, true)))
		});
		await store.load();
		await store.restartMail();
		expect(data.act).toHaveBeenCalledWith('mail-restart', expect.anything());
		expect(store.overview?.status.mailHelperPid).toBe(55);
		expect(flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: 'Mail-Helfer neu gestartet.'
		});
		expect(store.busy).toBeNull();
	});

	it('says why the mail helper does not run after the action', async () => {
		const { store, flags } = setup();
		await store.load();
		await store.restartMail();
		expect(flags.show).toHaveBeenCalledWith({
			tone: 'info',
			title: 'Mail-Helfer: Läuft nicht.',
			description: 'Kein Postfach ist eingeschaltet; er wird nicht gebraucht.'
		});
	});

	it('switches the autostart and shows a refusal next to the actions', async () => {
		let answer: SystemAnswer<SystemOverview> = ok(overview({ autostart: 'on' }));
		const { store, data, flags } = setup({ act: vi.fn(async () => answer) });
		await store.load();
		await store.setAutostart(true);
		expect(data.act).toHaveBeenCalledWith('autostart-on', expect.anything());
		expect(flags.show).toHaveBeenCalledWith({ tone: 'success', title: 'Autostart eingeschaltet.' });
		answer = { kind: 'denied', reason: 'script' };
		await store.setAutostart(false);
		expect(data.act).toHaveBeenLastCalledWith('autostart-off', expect.anything());
		expect(store.actionMessage?.tone).toBe('error');
		answer = { kind: 'denied', reason: 'busy' };
		await store.setAutostart(false);
		expect(store.actionMessage).toMatchObject({
			tone: 'warning',
			message: { title: 'Eine Aktion läuft gerade' }
		});
	});

	it('runs one action at a time', async () => {
		let release: () => void = () => undefined;
		const { store, data } = setup({
			act: vi.fn(
				() =>
					new Promise<SystemAnswer<SystemOverview>>((resolve) => {
						release = () => resolve(ok(overview()));
					})
			)
		});
		await store.load();
		const first = store.restartMail();
		expect(store.busy).toBe('mail-restart');
		await store.setAutostart(true);
		await store.restart();
		expect(data.act).toHaveBeenCalledTimes(1);
		release();
		await first;
		expect(store.busy).toBeNull();
	});
});

describe('SystemStore: restart', () => {
	it('waits until the server was gone and answers again, then loads the status', async () => {
		const health = [true, false, false, true];
		const { store, data, flags } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => health.shift() ?? true),
			status: vi
				.fn()
				.mockResolvedValueOnce(ok(overview()))
				.mockResolvedValue(ok(overview({ pid: 200, startedUtc: '2026-09-30T08:00:00Z' })))
		});
		await store.load();
		const running = store.restart();
		expect(store.busy).toBe('restart');
		await running;
		expect(data.act).toHaveBeenCalledWith('restart', expect.anything());
		expect(data.health).toHaveBeenCalledTimes(4);
		expect(store.restartPhase).toBe('idle');
		expect(store.overview?.status.pid).toBe(200);
		expect(flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: 'becauseyoulovejira wurde neu gestartet.',
			description: 'Läuft seit 30.09.2026 10:00.'
		});
		expect(store.busy).toBeNull();
	});

	it('shows "starting" while the server is gone', async () => {
		let seen = '';
		const { store } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi
				.fn()
				.mockImplementationOnce(async () => false)
				.mockImplementationOnce(async () => {
					seen = store.restartPhase;
					return true;
				}),
			status: vi
				.fn()
				.mockResolvedValueOnce(ok(overview()))
				.mockResolvedValue(ok(overview({ pid: 300 })))
		});
		await store.load();
		await store.restart();
		expect(seen).toBe('starting');
	});

	it('notices a restart so fast that the server never seemed gone, by its new start', async () => {
		const { store, data } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => true),
			status: vi
				.fn()
				.mockResolvedValueOnce(ok(overview()))
				.mockResolvedValueOnce(ok(overview()))
				.mockResolvedValue(ok(overview({ pid: 400, startedUtc: '2026-09-30T08:05:00Z' })))
		});
		await store.load();
		await store.restart();
		expect(store.restartPhase).toBe('idle');
		expect(store.overview?.status.pid).toBe(400);
		expect(data.status).toHaveBeenCalledTimes(3);
	});

	it('gives up after its time: "failed" when the server went and did not come back', async () => {
		const { store } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => false)
		});
		await store.load();
		await store.restart();
		expect(store.restartPhase).toBe('failed');
		expect(store.busy).toBeNull();
	});

	it('gives up after its time: "not-started" when the same server keeps answering', async () => {
		const { store, data } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => true)
		});
		await store.load();
		await store.restart();
		expect(store.restartPhase).toBe('not-started');
		// Asked about every second until the time was over.
		expect((data.health as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
			RESTART_TIMEOUT_MS / RESTART_POLL_MS + 1
		);
	});

	it('shows a refused restart next to the actions and starts nothing', async () => {
		const { store, data } = setup({
			act: vi.fn(async () => ({ kind: 'denied', reason: 'busy' }) as const)
		});
		await store.load();
		await store.restart();
		expect(store.actionMessage?.message.title).toBe('Eine Aktion läuft gerade');
		expect(data.health).not.toHaveBeenCalled();
		expect(store.restartPhase).toBe('idle');
	});

	it('stops asking when the page goes', async () => {
		const { store, data } = setup({
			act: vi.fn(async () => ok('restarting' as const)),
			health: vi.fn(async () => {
				store.dispose();
				return false;
			})
		});
		await store.load();
		await store.restart();
		expect(data.health).toHaveBeenCalledTimes(1);
	});
});
