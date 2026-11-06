// The routes of the pages of the administration in the data layer (FP-3b, ADR-0071): a 400 is a
// refused input only with `reason: 'invalid'` (the routes of credentials name their problem
// instead), every other 400 is a failure (DataError) with the Server-ID of its answer; a refusal and
// an answer of another form keep their entry beside the answer, whose form stays the same; an entry
// of the catalog of the scripts gives only its code and its problem, never its command.

import { ClientResponseError } from 'pocketbase';
import type PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import { problemReport, type ProblemEntry } from '../domain/problems';
import { createAccount, fetchAccounts, setAccountAdmin } from './accounts';
import { runBackupNow } from './backup';
import { setCredential } from './credentials';
import {
	DataError,
	denialProblem,
	noteRequest,
	noteServerProblem,
	problemOf,
	reportedScriptProblem,
	scriptProblem
} from './errors';
import { foundHousehold, joinHousehold } from './household';
import { saveSecurityHosts } from './security';
import { runStorageAction } from './storage';

const SERVER_ID = 'prob00000000001';

/**
 * A client whose `send` fails like the SDK with `status` and `response`, the request noted like the
 * client of the app and, for a failure of the app, the Server-ID of the header X-Byl-Problem.
 */
function failing(
	status: number,
	response: Record<string, unknown>,
	serverId: string | null = null
) {
	const send = vi.fn(async (path: string, options: { method: string }) => {
		const error = new ClientResponseError({
			url: `http://127.0.0.1:8090${path}`,
			status,
			response
		});
		noteServerProblem(error.response, status, serverId);
		noteRequest(error, options.method, path);
		throw error;
	});
	return { send } as unknown as PocketBase;
}

/** A client whose `send` answers `answer`. */
function answering(answer: unknown): PocketBase {
	return { send: vi.fn(async () => answer) } as unknown as PocketBase;
}

// What PocketBase 0.40.4 answers for an error of a hook (ADR-0077 §2).
const HOOK_FAILURE = {
	status: 400,
	message: 'Something went wrong while processing your request.'
};

describe('a 400 of the routes of the administration (FP-3b)', () => {
	// BYL-E6-2419
	it('is a failure with the Server-ID unless it says `reason: "invalid"`', async () => {
		const pb = failing(400, { ...HOOK_FAILURE, data: {} }, SERVER_ID);
		for (const run of [
			() => fetchAccounts(pb),
			() => saveSecurityHosts(pb, ['pi.example.org']),
			() => runStorageAction(pb, 'discarded'),
			() => setCredential(pb, 'BYL_TELEGRAM_TOKEN', 'Wert')
		]) {
			const failure = await run().catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(DataError);
			expect(problemOf(failure)).toMatchObject({
				outcome: { result: 'response', status: 400 },
				serverId: SERVER_ID
			});
		}
	});

	// BYL-E6-2420
	it('is a refused input with `reason: "invalid"`, also with 404 and 409 of the accounts', async () => {
		expect(
			await createAccount(
				failing(400, { reason: 'invalid', problem: 'email-taken', message: 'Vergeben.' }),
				{ email: 'anna@example.com', name: 'Anna' }
			)
		).toEqual({ kind: 'invalid', problem: 'email-taken' });
		expect(
			await setAccountAdmin(
				failing(409, { reason: 'invalid', problem: 'last-admin' }),
				'user0000000002',
				false
			)
		).toEqual({ kind: 'invalid', problem: 'last-admin' });
		expect(
			await saveSecurityHosts(
				failing(400, { reason: 'invalid', problem: 'invalid', invalid: ['x'] }),
				['x']
			)
		).toEqual({ kind: 'invalid', problem: 'invalid', invalid: ['x'] });
		expect(
			await runStorageAction(
				failing(400, { reason: 'invalid', message: 'Diese Gruppe gibt es nicht.' }),
				'leftovers',
				['programs']
			)
		).toEqual({ kind: 'invalid', message: 'Diese Gruppe gibt es nicht.' });
		// The routes of credentials send no `reason`; their problem says it is a refused input.
		expect(
			await setCredential(
				failing(400, { status: 400, problem: 'control', message: 'Steuerzeichen.' }),
				'BYL_TELEGRAM_TOKEN',
				'Wert'
			)
		).toEqual({ kind: 'invalid', problem: 'control', message: 'Steuerzeichen.', details: null });
	});

	// BYL-E6-2439
	it('gives `problem: "write"` of the access data an entry, every other problem none (R-A1)', async () => {
		const value = 'Marker-Wert-5e1d';
		const answer = await setCredential(
			failing(400, {
				status: 400,
				problem: 'write',
				message: 'Windows hat die Variable nicht gespeichert.'
			}),
			'BYL_TELEGRAM_TOKEN',
			value
		);
		expect(answer).toMatchObject({
			kind: 'invalid',
			problem: 'write',
			message: 'Windows hat die Variable nicht gespeichert.'
		});
		const details = answer.kind === 'invalid' ? answer.details : null;
		expect(details).toMatchObject({
			intent: 'Zugangsdaten setzen',
			outcome: {
				result: 'response',
				status: 400,
				message: 'Windows hat die Variable nicht gespeichert.'
			},
			request: { method: 'POST', path: '/api/byl/credentials/set' }
		});
		expect(problemReport(details as ProblemEntry)).not.toContain(value);
		// The other problems are refused inputs: no entry.
		for (const problem of ['invalid', 'name', 'blocked', 'unknown', 'empty', 'control', 'long']) {
			expect(
				await setCredential(failing(400, { status: 400, problem }), 'BYL_TELEGRAM_TOKEN', value),
				problem
			).toEqual({ kind: 'invalid', problem, message: null, details: null });
		}
	});
});

describe('entries beside the answers (T1, FP-3b)', () => {
	// BYL-E6-2420
	it('keeps the entry of a refusal beside the answer; only "script" is a failure', async () => {
		const owner = await fetchAccounts(failing(403, { reason: 'owner' }));
		expect(owner).toEqual({ kind: 'denied', reason: 'owner' });
		expect(denialProblem(owner)).toMatchObject({ outcome: { status: 403, code: 'owner' } });
		expect(owner.kind === 'denied' && scriptProblem(owner)).toBeNull();

		const script = await runBackupNow(failing(502, { reason: 'script', message: 'Abbruch.' }));
		expect(script).toEqual({ kind: 'denied', reason: 'script' });
		expect(script.kind === 'denied' && scriptProblem(script)).toMatchObject({
			intent: 'Jetzt sichern',
			outcome: { result: 'response', status: 502, code: 'script' },
			request: { method: 'POST', path: '/api/byl/backup/run' }
		});
	});

	// BYL-E6-2420
	it('names an answer of another form "Unerwartete Antwort des Servers" with its request', async () => {
		const answer = await saveSecurityHosts(answering({ unexpected: true }), ['pi.example.org']);
		expect(answer).toEqual({ kind: 'denied', reason: 'script' });
		expect(answer.kind === 'denied' && scriptProblem(answer)).toMatchObject({
			intent: 'Zusätzliche Hosts speichern',
			outcome: { result: 'answer' },
			request: { method: 'POST', path: '/api/byl/security/hosts' }
		});
	});

	// BYL-E6-2421
	it('throws an answer of another form of the household as a failure with its request', async () => {
		const failure = await foundHousehold(answering({ unexpected: true }), 'Haus').catch(
			(error: unknown) => error
		);
		expect(failure).toBeInstanceOf(DataError);
		expect(problemOf(failure)).toMatchObject({
			intent: 'Haushalt gründen',
			outcome: { result: 'answer' },
			request: { method: 'POST', path: '/api/byl/household' }
		});
		// A refused code stays the neutral refusal, the rate limit a hint: no failure.
		expect(
			await joinHousehold(failing(400, { reason: 'invalid', problem: 'code' }), 'ABCD-EFGH')
		).toEqual({ kind: 'invalid', problem: 'code' });
		expect(await joinHousehold(failing(429, {}), 'ABCD-EFGH')).toEqual({ kind: 'rate' });
	});
});

describe('"Mein Konto" (P3, FP-3b)', () => {
	// BYL-E6-2418
	it('gives a wrong current password no entry: a hint at its field', () => {
		const refused = new DataError('validation', {
			status: 400,
			fields: {
				oldPassword: { code: 'validation_invalid_old_password', message: 'Ungültige Eingabe.' }
			}
		});
		expect(problemOf(refused)).toBeNull();
	});
});

describe('entries of the catalog of the scripts (T3, FP-3b)', () => {
	// BYL-E6-2419
	it('takes only code and problem of a report, never the command or the paths', () => {
		const report = {
			code: 'lan-firewall-failed',
			level: 'error' as const,
			exitCode: 1,
			problem: 'netsh hat die Regel nicht angelegt.',
			facts: ['Benutzer C:\\Users\\anna'],
			cause: 'Die Datei C:\\Users\\anna\\app\\byl-control.ps1 fehlt.',
			remedy: {
				steps: ['Als Administrator ausführen.'],
				command: 'netsh advfirewall firewall add rule name="becauseyoulovejira Heimnetz"'
			},
			log: 'C:\\Users\\anna\\app\\logs\\byl-control.log'
		};
		const problem = reportedScriptProblem({
			intent: 'Firewall-Regel ändern',
			method: 'POST',
			path: '/api/byl/security/lan/firewall',
			report,
			code: 'failed',
			message: 'netsh hat einen Fehler gemeldet'
		});
		expect(problem.outcome).toEqual({
			result: 'reported',
			status: null,
			code: 'lan-firewall-failed',
			message: 'netsh hat die Regel nicht angelegt.'
		});
		const text = problemReport(problem);
		for (const part of ['netsh advfirewall', 'anna', 'byl-control', 'Administrator ausführen']) {
			expect(text, part).not.toContain(part);
		}
		// Without a report the outcome stands in.
		expect(
			reportedScriptProblem({
				intent: 'Firewall-Regel ändern',
				method: 'POST',
				path: '/api/byl/security/lan/firewall',
				report: null,
				code: 'timeout',
				message: 'Windows hat nicht rechtzeitig geantwortet'
			}).outcome
		).toMatchObject({ code: 'timeout', message: 'Windows hat nicht rechtzeitig geantwortet' });
	});
});
