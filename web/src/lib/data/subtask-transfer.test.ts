// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070), the request of the data layer: the body and the
// answer, and the two kinds of 404. Only a 404 without the field `ticket` means "the server does not
// know the route yet" (before its restart); the route itself answers a missing ticket with that field.
// The SDK is a fake with `send`, as the errors of the SDK are read by structure.

import type PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import { NO_TRANSFER_FIELDS, type TransferRequest } from '../domain/subtask-transfer';
import { DataError } from './errors';
import { transferToSubtasks } from './subtask-transfer';

const REQUEST: TransferRequest = {
	expectedUpdated: '2026-10-02 10:00:00.000Z',
	fields: { ...NO_TRANSFER_FIELDS, due: { mode: 'same' } },
	targets: ['child0000000001']
};

function fakeClient(send: () => Promise<unknown>) {
	const fn = vi.fn(send);
	return { client: { send: fn } as unknown as PocketBase, send: fn };
}

function responseError(status: number, data: Record<string, unknown> = {}) {
	return Object.assign(new Error(`status ${status}`), {
		status,
		response: { status, message: '', data },
		isAbort: false
	});
}

describe('transferToSubtasks', () => {
	it('posts the body to the route of the ticket and reads the answer', async () => {
		const { client, send } = fakeClient(async () => ({
			parent: { id: 'parent000000001', key: 'HAUS-12' },
			changed: 1,
			unchanged: 0,
			tickets: [{ id: 'child0000000001', key: 'HAUS-13', previous_key: 'HAUS-13' }]
		}));
		expect(await transferToSubtasks(client, 'parent000000001', REQUEST)).toEqual({
			parent: { id: 'parent000000001', key: 'HAUS-12' },
			changed: 1,
			unchanged: 0,
			tickets: [{ id: 'child0000000001', key: 'HAUS-13', previousKey: 'HAUS-13' }]
		});
		expect(send).toHaveBeenCalledExactlyOnceWith(
			'/api/byl/tickets/parent000000001/subtasks/transfer',
			expect.objectContaining({
				method: 'POST',
				body: {
					expected_updated: '2026-10-02 10:00:00.000Z',
					fields: { due: { mode: 'same' } },
					targets: ['child0000000001']
				}
			})
		);
	});

	it('answers null for a server without the route (404 without the field ticket)', async () => {
		const { client } = fakeClient(async () => Promise.reject(responseError(404)));
		expect(await transferToSubtasks(client, 'parent000000001', REQUEST)).toBeNull();
	});

	it('throws a ticket that is gone, a refusal, 409 and a broken answer', async () => {
		const gone = fakeClient(async () =>
			Promise.reject(
				responseError(404, { ticket: { code: 'validation_transfer_missing', message: 'x' } })
			)
		).client;
		await expect(transferToSubtasks(gone, 'p', REQUEST)).rejects.toMatchObject({
			kind: 'not_found'
		});
		const stale = fakeClient(async () => Promise.reject(responseError(409))).client;
		await expect(transferToSubtasks(stale, 'p', REQUEST)).rejects.toMatchObject({ status: 409 });
		const refused = fakeClient(async () =>
			Promise.reject(
				responseError(400, { targets: { code: 'validation_transfer_target', message: 'x' } })
			)
		).client;
		await expect(transferToSubtasks(refused, 'p', REQUEST)).rejects.toMatchObject({
			kind: 'validation',
			fields: { targets: { code: 'validation_transfer_target' } }
		});
		const broken = fakeClient(async () => ({ changed: 'viele' })).client;
		await expect(transferToSubtasks(broken, 'p', REQUEST)).rejects.toBeInstanceOf(DataError);
	});
});
