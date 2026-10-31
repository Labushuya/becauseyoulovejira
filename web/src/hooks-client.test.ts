// The client hooks (FP-1, ADR-0071 §4): from the start of the app on, every error nobody caught
// lands in the list "Fehler dieser Sitzung" of the tab, an event "error" of the window as well as an
// unhandled rejection. The list itself is covered in src/lib/stores/problem-log.test.ts. Since MO-7c2
// the start also holds the address the app opened, before the session check (ADR-0073 addendum).

import { describe, expect, it, vi } from 'vitest';
import { takeStart } from '$lib/app-start';
import { PROBLEM_LOG_KEY } from '$lib/domain/problems';
import { problemLog } from '$lib/stores/problem-log.svelte';
import { handleError, init } from './hooks.client';

describe('init of the client hooks', () => {
	it('records errors and rejections nobody caught as "Unerwarteter Fehler"', async () => {
		problemLog.clear();
		await init();

		const error = new TypeError("Cannot read properties of undefined (reading 'title')");
		window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }));
		const rejection = new Event('unhandledrejection');
		Object.defineProperty(rejection, 'reason', { value: new Error('Abgelehnt.') });
		window.dispatchEvent(rejection);

		expect(problemLog.entries.map((entry) => [entry.intent, entry.exception?.message])).toEqual([
			['Unerwarteter Fehler', 'Abgelehnt.'],
			['Unerwarteter Fehler', "Cannot read properties of undefined (reading 'title')"]
		]);
		expect(sessionStorage.getItem(PROBLEM_LOG_KEY)).toContain('Abgelehnt.');
	});

	it('keeps the German message of handleError', () => {
		expect(
			handleError({
				error: new Error('x'),
				event: {} as never,
				status: 500,
				message: 'Internal Error'
			})
		).toEqual({ message: 'Ein unerwarteter Fehler ist aufgetreten.' });
	});

	it('holds the address the app opened before the session check, for one taker only (MO-7c2)', async () => {
		window.history.replaceState(null, '', '/?karte=heute#oben');
		const entries = vi
			.spyOn(performance, 'getEntriesByType')
			.mockReturnValue([{ type: 'navigate' } as unknown as PerformanceEntry]);
		try {
			await init();
			expect(takeStart()).toEqual({
				pathname: '/',
				search: '?karte=heute',
				hash: '#oben',
				referrer: '',
				origin: window.location.origin,
				navigation: 'navigate'
			});
			// The app layout takes it when it shows; a second sign-in in the same tab finds none.
			expect(takeStart()).toBeNull();
		} finally {
			entries.mockRestore();
			window.history.replaceState(null, '', '/');
		}
	});
});
