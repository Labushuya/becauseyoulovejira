// The client hooks (FP-1, ADR-0071 §4): from the start of the app on, every error nobody caught
// lands in the list "Fehler dieser Sitzung" of the tab, an event "error" of the window as well as an
// unhandled rejection. The list itself is covered in src/lib/stores/problem-log.test.ts.

import { describe, expect, it } from 'vitest';
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
});
