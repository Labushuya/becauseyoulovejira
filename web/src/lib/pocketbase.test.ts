import { LocalAuthStore } from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problemOf, toDataError } from './data/errors';
import { problemReport, type ProblemEntry } from './domain/problems';
import { pb } from './pocketbase';

afterEach(() => {
	vi.unstubAllGlobals();
	pb.authStore.clear();
});

describe('pb', () => {
	it('talks to its own origin and keeps the session in localStorage', () => {
		expect(pb.baseURL).toBe('/');
		expect(pb.authStore).toBeInstanceOf(LocalAuthStore);
	});

	it('does not abort a pending request when an identical one starts', async () => {
		// Resolves on the next tick unless the SDK aborts the request through its signal.
		const fetchMock = vi.fn<typeof fetch>(
			(_input, init) =>
				new Promise<Response>((resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('Aborted', 'AbortError'))
					);
					setTimeout(() => resolve(Response.json({ code: 200, message: 'API is healthy.' })));
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const results = await Promise.all([pb.health.check(), pb.health.check()]);

		expect(results).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('notes method and path of a failed request for the details, never body or header (FP-1)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		pb.authStore.save('eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUxIn0.c2lnbmF0dXJl', null);

		const error = await pb
			.collection('tickets')
			.update('abc123def456789', { title: 'Geheimer Titel' }, { query: { expand: 'tags' } })
			.catch((caught: unknown) => caught);
		const problem = problemOf(toDataError(error));

		expect(problem).toMatchObject({
			intent: 'Ticket speichern',
			outcome: { result: 'network' },
			request: { method: 'PATCH', path: '/api/collections/tickets/records/abc123def456789' }
		});
		const report = problemReport(problem as ProblemEntry);
		for (const secret of ['Geheimer Titel', 'eyJ', 'expand', 'Authorization']) {
			expect(report, secret).not.toContain(secret);
		}
	});

	it('notes the path of an error answer of a route of BYL with its method (FP-1)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async () =>
				Response.json({ status: 409, message: 'Geändert.', data: {} }, { status: 409 })
			)
		);

		const error = await pb
			.send('/api/byl/tickets/abc123def456789/subtasks/transfer', {
				method: 'POST',
				body: { expected_updated: 'x' }
			})
			.catch((caught: unknown) => caught);

		expect(problemOf(toDataError(error))).toMatchObject({
			intent: 'Unteraufgaben übertragen',
			outcome: { result: 'response', status: 409, message: 'Geändert.' },
			request: { method: 'POST', path: '/api/byl/tickets/abc123def456789/subtasks/transfer' }
		});
	});

	it('takes the entry of the log of the server an unexpected 5xx names as Server-ID (FP-2)', async () => {
		const answer = (status: number, id: string) =>
			vi.fn<typeof fetch>(async () =>
				Response.json(
					{ status, message: 'Something went wrong while processing your request.', data: {} },
					{ status, headers: { 'X-Byl-Problem': id } }
				)
			);
		vi.stubGlobal('fetch', answer(500, 'abc123def456ghi'));
		const failed = await pb
			.send('/api/byl/tickets/abc123def456789/duplicate', { method: 'POST', body: {} })
			.catch((caught: unknown) => caught);
		const problem = problemOf(toDataError(failed)) as ProblemEntry;
		expect(problem).toMatchObject({ serverId: 'abc123def456ghi', outcome: { status: 500 } });
		expect(problemReport(problem)).toContain('Server-ID: abc123def456ghi');

		// Only a 5xx and only an ID of the right form; the body stays as PocketBase sent it.
		for (const [status, id] of [
			[409, 'abc123def456ghi'],
			[500, 'kein-gueltiger-wert']
		] as const) {
			vi.stubGlobal('fetch', answer(status, id));
			const other = await pb
				.send('/api/byl/tickets/abc123def456789/duplicate', { method: 'POST', body: {} })
				.catch((caught: unknown) => caught);
			expect(problemOf(toDataError(other))?.serverId, `${status} ${id}`).toBeNull();
			expect(Object.keys((other as { response: object }).response).sort()).toEqual([
				'data',
				'message',
				'status'
			]);
		}
	});
});
