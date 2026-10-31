// Data layer of the access data (BW-3, ADR-0075): a value goes only into the body of the POST of
// "Setzen", never into the address or the query; names of a setup go into the query of the state;
// the answers of the routes become their kinds (ok, denied with the reason of the checks of the
// page System, invalid with the words of the server), a missing connection a DataError.

import type PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import {
	fetchCredentialStatus,
	fetchRestartNotice,
	removeCredential,
	setCredential
} from './credentials';
import { DataError } from './errors';

const MARKER = 'Marker-Wert-c0ffee';

/** A client whose `send` answers `answer` (or throws it as the SDK does with a status). */
function client(answer: unknown, fail = false) {
	const send = vi.fn(async () => {
		if (fail) throw answer;
		return answer;
	});
	return { pb: { send } as unknown as PocketBase, send };
}

describe('data/credentials.ts', () => {
	it('sends the value only in the body of the POST', async () => {
		const { pb, send } = client({ name: 'BYL_TELEGRAM_TOKEN', set: true, restartNeeded: true });
		const answer = await setCredential(pb, 'BYL_TELEGRAM_TOKEN', MARKER);
		expect(answer).toEqual({
			kind: 'ok',
			value: { name: 'BYL_TELEGRAM_TOKEN', set: true, restartNeeded: true }
		});
		const [path, options] = send.mock.calls[0] as unknown as [string, Record<string, unknown>];
		expect(path).toBe('/api/byl/credentials/set');
		expect(options).toMatchObject({
			method: 'POST',
			body: { name: 'BYL_TELEGRAM_TOKEN', value: MARKER }
		});
		expect(options.query).toBeUndefined();
		expect(path).not.toContain(MARKER);
	});

	it('asks the state with the names of a setup in the query, never a value', async () => {
		const { pb, send } = client({
			variables: [{ name: 'BYL_WEBDE_PASSWORD', set: false, blocked: false, channels: [] }],
			restartNeeded: false
		});
		const answer = await fetchCredentialStatus(pb, ['BYL_WEBDE_PASSWORD', 'BYL_TELEGRAM_TOKEN_2']);
		expect(answer).toEqual({
			kind: 'ok',
			value: {
				variables: [{ name: 'BYL_WEBDE_PASSWORD', set: false, blocked: false, channels: [] }],
				restartNeeded: false
			}
		});
		expect(send).toHaveBeenCalledWith(
			'/api/byl/credentials',
			expect.objectContaining({
				method: 'GET',
				query: { names: 'BYL_WEBDE_PASSWORD,BYL_TELEGRAM_TOKEN_2' }
			})
		);
	});

	it('turns a 400 into the problem of the field and a refusal into its reason', async () => {
		const invalid = client(
			{ status: 400, response: { problem: 'control', message: 'Steuerzeichen.' } },
			true
		);
		expect(await setCredential(invalid.pb, 'BYL_TELEGRAM_TOKEN', MARKER)).toEqual({
			kind: 'invalid',
			problem: 'control',
			message: 'Steuerzeichen.'
		});
		const remote = client({ status: 403, response: { reason: 'loopback' } }, true);
		expect(await removeCredential(remote.pb, 'BYL_TELEGRAM_TOKEN')).toEqual({
			kind: 'denied',
			reason: 'loopback',
			problem: null
		});
		const busy = client({ status: 409, response: { reason: 'busy' } }, true);
		expect(await setCredential(busy.pb, 'BYL_TELEGRAM_TOKEN', MARKER)).toMatchObject({
			kind: 'denied',
			reason: 'busy'
		});
	});

	it('fails without a connection, so nothing is kept for later', async () => {
		const offline = client(
			{ status: 0, isAbort: false, originalError: new TypeError('fetch') },
			true
		);
		await expect(setCredential(offline.pb, 'BYL_TELEGRAM_TOKEN', MARKER)).rejects.toBeInstanceOf(
			DataError
		);
		await expect(setCredential(offline.pb, 'BYL_TELEGRAM_TOKEN', MARKER)).rejects.toMatchObject({
			kind: 'network'
		});
	});

	it('reads the hint as yes or no and refuses an answer of another form', async () => {
		expect(await fetchRestartNotice(client({ needed: true }).pb)).toEqual({
			kind: 'ok',
			value: true
		});
		expect(await fetchRestartNotice(client({ needed: 'ja' }).pb)).toMatchObject({
			kind: 'denied',
			reason: 'script'
		});
		expect(await setCredential(client({ value: MARKER }).pb, 'BYL_X', MARKER)).toMatchObject({
			kind: 'denied',
			reason: 'script'
		});
	});
});
