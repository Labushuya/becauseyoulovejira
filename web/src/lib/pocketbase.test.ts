import { LocalAuthStore } from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import { pb } from './pocketbase';

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
});
