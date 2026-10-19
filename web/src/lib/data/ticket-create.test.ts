// What the server knows for "Neues Ticket" and "Duplizieren" (GET /api/byl/tickets/create, NT-1,
// UT-1, UT-2): only a missing route (404, before the restart) means "the server does not know it";
// every other failure stays a failure, so the forms can say why and ask again instead of naming a
// restart (UT-2, K3). The SDK is a fake with `send`, as the errors of the SDK are read by structure.

import type PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from './errors';
import { fetchCreateSupport } from './ticket-create';

function fakeClient(send: () => Promise<unknown>): PocketBase {
	return { send: vi.fn(send) } as unknown as PocketBase;
}

/** An error of the SDK as it arrives: a status and the answer of the server. */
function responseError(status: number) {
	return Object.assign(new Error(`status ${status}`), { status, response: {}, isAbort: false });
}

describe('fetchCreateSupport', () => {
	it('reads the answer of the route', async () => {
		const client = fakeClient(async () => ({
			subtask_status: true,
			duplicate_subtask_status: true
		}));
		expect(await fetchCreateSupport(client)).toMatchObject({
			subtaskStatus: true,
			duplicateSubtaskStatus: true,
			recurrence: false
		});
	});

	it('answers null only for a missing route (before the restart)', async () => {
		expect(
			await fetchCreateSupport(fakeClient(async () => Promise.reject(responseError(404))))
		).toBeNull();
	});

	it('throws every other failure as it is: no connection, a server error, a broken answer', async () => {
		for (const [failure, kind] of [
			[responseError(0), 'network'],
			[responseError(500), 'server'],
			[responseError(401), 'session']
		] as const) {
			const error = await fetchCreateSupport(fakeClient(async () => Promise.reject(failure))).catch(
				(caught: unknown) => caught
			);
			expect(error, kind).toBeInstanceOf(DataError);
			expect((error as DataError).kind, kind).toBe(kind);
		}
		const broken = await fetchCreateSupport(fakeClient(async () => 'ok')).catch(
			(caught: unknown) => caught
		);
		expect((broken as DataError).kind).toBe('server');
	});
});
