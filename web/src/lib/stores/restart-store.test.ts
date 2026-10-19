// "Jetzt neu starten" outside the page System (BW-1, ADR-0072) with fake data and a fake clock: the
// store reads the status, starts the restart through the route of the page System, waits for the
// server to go and come back and keeps the result at the place it was started from; refusals are
// warnings, "script" an error, failures and timeouts carry their entries for "Details" (FP-1) with
// the intent of the action; the mail helper; one run at a time; reset; no session.

import type PocketBase from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import {
	fakeRestartClock,
	fakeRestartData,
	ok,
	restartOverview,
	restartStoreOf
} from '$lib/test/restart-fake';
import { DataError, noteRequest } from '$lib/data/errors';
import { denialProblem, runSystemAction } from '$lib/data/system';
import { RESTART_TIMEOUT_MS } from './restart-follow';
import { RESTART_INTENTS, RestartStore } from './restart.svelte';
import { systemData } from './system.svelte';

const PLACE = 'setup:telegram:conn00000000002:restart';

beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

/** A client of the SDK whose `send` answers with `answer` or fails like the SDK with `status`. */
function fakeClient(answer: { status: number; reason?: string } | unknown) {
	const failure =
		typeof answer === 'object' && answer !== null && 'status' in answer
			? (answer as { status: number; reason?: string })
			: null;
	return {
		send: vi.fn(async (path: string, options: { method: string }) => {
			if (failure === null) return answer;
			const error = {
				status: failure.status,
				url: `http://127.0.0.1:8090${path}`,
				isAbort: false,
				response: { reason: failure.reason, message: 'Das Steuerskript hat abgebrochen.' }
			};
			// The client of the app notes method and path of every failed request (lib/pocketbase.ts).
			noteRequest(error, options.method, path);
			throw error;
		}),
		health: { check: vi.fn(async () => ({})) }
	} as unknown as PocketBase;
}

describe('RestartStore: restart in place', () => {
	it('reads the status, starts the restart, waits for the server and keeps the result at its place', async () => {
		const data = fakeRestartData();
		const store = restartStoreOf(data);
		const result = await store.restart(PLACE);

		expect(data.status).toHaveBeenCalledTimes(2);
		expect(data.act).toHaveBeenCalledWith('restart', expect.anything());
		expect(data.health).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ kind: 'restarted', overview: { status: { pid: 200 } } });
		expect(store.running).toBeNull();
		expect(store.resultAt(PLACE)).toBe(result);
		// Another place shows nothing of it.
		expect(store.resultAt('setup:kalender:neu:restart')).toBeNull();
		store.clear(PLACE);
		expect(store.resultAt(PLACE)).toBeNull();
	});

	it('goes through "preparing", "stopping" and "starting" at its place only', async () => {
		const seen: (string | null)[] = [];
		const data = fakeRestartData();
		const store = restartStoreOf(data);
		data.act.mockImplementationOnce(async () => {
			seen.push(store.phaseAt(PLACE), store.phaseAt('elsewhere'));
			return ok('restarting' as const);
		});
		data.health.mockImplementationOnce(async () => {
			seen.push(store.phaseAt(PLACE));
			return false;
		});
		data.health.mockImplementationOnce(async () => {
			seen.push(store.phaseAt(PLACE));
			return true;
		});
		const running = store.restart(PLACE);
		expect(store.runningAt(PLACE)).toBe(true);
		expect(store.runningAt('elsewhere')).toBe(false);
		await running;
		expect(seen).toEqual(['preparing', null, 'stopping', 'starting']);
		expect(store.phaseAt(PLACE)).toBeNull();
	});

	it('shows a refusal as a warning without details, "script" as an error with its details', async () => {
		const data = fakeRestartData();
		data.act.mockResolvedValueOnce({ kind: 'denied', reason: 'busy' });
		const store = restartStoreOf(data);
		expect(await store.restart(PLACE)).toMatchObject({
			kind: 'refused',
			tone: 'warning',
			reason: 'busy',
			message: { title: 'Eine Aktion läuft gerade' },
			problem: null
		});
		expect(data.health).not.toHaveBeenCalled();

		// Through the data layer of the page System: the refusal keeps its entry beside the answer.
		const pb = fakeClient({ status: 502, reason: 'script' });
		const real = new RestartStore(
			{ ...systemData(pb), status: async () => ok(restartOverview()) },
			{ ensureValid: () => true, logout: vi.fn() },
			fakeRestartClock()
		);
		const refused = await real.restart(PLACE);
		expect(refused).toMatchObject({
			kind: 'refused',
			tone: 'error',
			reason: 'script',
			// The text of the page System names status.bat; here the scripts stand under „Notfall“.
			message: { text: expect.not.stringMatching(/\.bat/) }
		});
		expect(refused?.kind === 'refused' ? refused.problem : null).toMatchObject({
			intent: 'App neu starten',
			outcome: { result: 'response', status: 502, code: 'script' },
			request: { method: 'POST', path: '/api/byl/system/actions/restart' }
		});
	});

	it('gives a failed request its details with the intent of the action', async () => {
		const data = fakeRestartData();
		data.status.mockReset();
		data.status.mockRejectedValue(new DataError('network'));
		const store = restartStoreOf(data);
		const result = await store.restart(PLACE);
		expect(result).toMatchObject({
			kind: 'failed',
			message: {
				title: 'Nicht neu gestartet',
				text: expect.stringMatching(/^Server nicht erreichbar/)
			}
		});
		expect(result?.kind === 'failed' ? result.problem : null).toMatchObject({
			intent: RESTART_INTENTS.restart,
			outcome: { result: 'network' }
		});
		expect(data.act).not.toHaveBeenCalled();
	});

	it('gives up after its time with details: the server did not come back', async () => {
		const data = fakeRestartData();
		data.health.mockImplementation(async () => false);
		const result = await restartStoreOf(data).restart(PLACE);
		expect(result).toMatchObject({
			kind: 'failed',
			message: { title: 'Die App antwortet nach dem Neustart nicht' },
			problem: {
				intent: 'App neu starten',
				outcome: { result: 'network' },
				request: { method: 'GET', path: '/api/health' }
			}
		});
		expect(result?.kind === 'failed' ? result.message.text : '').not.toMatch(/\.bat/);
	});

	it('gives up after its time with details: the restart did not begin, with the error the script kept', async () => {
		const data = fakeRestartData();
		const same = ok(
			restartOverview({
				backgroundProblem: {
					atUtc: '2026-10-19T08:00:00Z',
					run: 'restart',
					report: {
						code: 'restart-failed',
						level: 'error',
						exitCode: 1,
						problem: 'Der Neustart ist gescheitert.',
						facts: [],
						cause: '',
						remedy: { steps: [], command: '' },
						log: ''
					}
				}
			})
		);
		data.status.mockReset();
		data.status.mockResolvedValue(same);
		data.health.mockImplementation(async () => true);
		const result = await restartStoreOf(data).restart(PLACE);
		expect(result).toMatchObject({
			kind: 'failed',
			message: { title: 'Der Neustart hat nicht begonnen' },
			problem: {
				intent: 'App neu starten',
				outcome: {
					result: 'reported',
					code: 'restart-failed',
					message: 'Der Neustart ist gescheitert.'
				}
			}
		});
		// Asked about every second until the time was over.
		expect(data.health.mock.calls.length).toBe(RESTART_TIMEOUT_MS / 1000 + 1);
	});
});

describe('RestartStore: mail helper, one run at a time, session', () => {
	it('restarts the mail helper and says whether it runs', async () => {
		const data = fakeRestartData();
		const store = restartStoreOf(data);
		expect(await store.restartMail('setup:webde:conn00000000003:first-run')).toMatchObject({
			kind: 'mail',
			overview: { mail: { running: true } }
		});
		expect(data.act).toHaveBeenCalledWith('mail-restart', expect.anything());
		expect(data.status).not.toHaveBeenCalled();
		expect(data.health).not.toHaveBeenCalled();
	});

	it('runs one action at a time and ends a run with reset', async () => {
		const data = fakeRestartData();
		let release: () => void = () => undefined;
		data.act.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve(ok('restarting' as const));
				})
		);
		const store = restartStoreOf(data);
		const first = store.restart(PLACE);
		await vi.waitFor(() => expect(data.act).toHaveBeenCalledTimes(1));
		expect(store.running).toBe('restart');
		expect(await store.restartMail('other')).toBeNull();
		expect(data.act).toHaveBeenCalledTimes(1);

		store.reset();
		expect(store.running).toBeNull();
		release();
		expect(await first).toBeNull();
		expect(store.resultAt(PLACE)).toBeNull();
	});

	it('starts nothing without a session and ends it on 401', async () => {
		const data = fakeRestartData();
		const signedOut = new RestartStore(data, { ensureValid: () => false, logout: vi.fn() });
		expect(await signedOut.restart(PLACE)).toBeNull();
		expect(data.status).not.toHaveBeenCalled();

		const logout = vi.fn();
		data.status.mockReset();
		data.status.mockRejectedValue(new DataError('session', { status: 401 }));
		const expired = new RestartStore(data, { ensureValid: () => true, logout }, fakeRestartClock());
		expect(await expired.restart(PLACE)).toBeNull();
		expect(logout).toHaveBeenCalledTimes(1);
	});
});

describe('data layer of the page System: entries beside the answers (BW-1)', () => {
	it('keeps the entry of an answer the app could not read, with method and path', async () => {
		const answer = await runSystemAction(fakeClient({ restarting: 'ja' }), 'restart');
		expect(answer).toEqual({ kind: 'denied', reason: 'script' });
		expect(denialProblem(answer)).toMatchObject({
			intent: 'App neu starten',
			outcome: { result: 'answer' },
			request: { method: 'POST', path: '/api/byl/system/actions/restart' }
		});
		expect(denialProblem(ok('restarting'))).toBeNull();
	});
});
