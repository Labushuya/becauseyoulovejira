// The list "Fehler dieser Sitzung" (FP-1, ADR-0071 §4): each entry once, only in sessionStorage
// (a reload keeps it), "Liste leeren", blocked storage, and the errors nobody caught.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientProblem, PROBLEM_LOG_KEY, type ProblemEntry } from '$lib/domain/problems';
import { ProblemLog, watchUnexpectedErrors, type ProblemStorage } from './problem-log.svelte';

/** The errors these tests raise on purpose: a listener of the test, so Vitest leaves them alone. */
const ownErrors = (event: Event) => event.preventDefault();

const AT = Date.UTC(2026, 9, 19, 12, 0, 0);

function problem(id: string, intent = 'Ticket speichern', at = AT): ProblemEntry {
	return clientProblem({
		id,
		intent,
		at,
		outcome: { result: 'network', status: null, code: null, message: null },
		request: { method: 'PATCH', path: '/api/collections/tickets/records/abc123def456789' },
		app: null,
		exception: null
	});
}

beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
	window.addEventListener('error', ownErrors);
});

afterEach(() => window.removeEventListener('error', ownErrors));

describe('ProblemLog', () => {
	it('takes each entry once, newest first', () => {
		const log = new ProblemLog(sessionStorage);
		const first = problem('a');
		log.record(first);
		log.record(first);
		log.record(problem('b', 'Kanal jetzt abrufen', AT + 60_000));
		log.record(null);
		expect(log.entries.map((entry) => entry.id)).toEqual(['b', 'a']);
		expect(log.count).toBe(2);
	});

	it('keeps the list in sessionStorage only, so a reload of the tab still has it', () => {
		const log = new ProblemLog(sessionStorage);
		log.record(problem('a'));
		expect(localStorage.length).toBe(0);
		expect(JSON.parse(sessionStorage.getItem(PROBLEM_LOG_KEY) ?? '[]')).toHaveLength(1);

		const reloaded = new ProblemLog(sessionStorage);
		expect(reloaded.entries).toEqual(log.entries);
	});

	it('empties the list and the storage with "Liste leeren"', () => {
		const log = new ProblemLog(sessionStorage);
		log.record(problem('a'));
		log.clear();
		expect(log.count).toBe(0);
		expect(sessionStorage.getItem(PROBLEM_LOG_KEY)).toBeNull();
	});

	it('works on with blocked storage, for this page', () => {
		const blocked: ProblemStorage = {
			getItem: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
			setItem: () => {
				throw new DOMException('full', 'QuotaExceededError');
			},
			removeItem: () => {
				throw new DOMException('blocked', 'SecurityError');
			}
		};
		const log = new ProblemLog(blocked);
		log.record(problem('a'));
		expect(log.count).toBe(1);
		log.clear();
		expect(log.count).toBe(0);
		expect(new ProblemLog(null).count).toBe(0);
	});

	it('opens and closes the dialog', () => {
		const log = new ProblemLog(null);
		expect(log.dialogOpen).toBe(false);
		log.openDialog();
		expect(log.dialogOpen).toBe(true);
		log.closeDialog();
		expect(log.dialogOpen).toBe(false);
	});
});

describe('errors nobody caught', () => {
	it('takes an error event of the window as "Unerwarteter Fehler" with its exception', () => {
		const log = new ProblemLog(sessionStorage);
		const stop = watchUnexpectedErrors(window, log);
		try {
			const error = new TypeError("Cannot read properties of null (reading 'id')");
			window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }));
		} finally {
			stop();
		}
		expect(log.entries).toHaveLength(1);
		expect(log.entries[0]).toMatchObject({
			intent: 'Unerwarteter Fehler',
			outcome: { result: 'exception' },
			exception: { name: 'TypeError', message: "Cannot read properties of null (reading 'id')" }
		});
	});

	it('takes an unhandled rejection with its reason', () => {
		const log = new ProblemLog(sessionStorage);
		const stop = watchUnexpectedErrors(window, log);
		try {
			const event = new Event('unhandledrejection');
			Object.defineProperty(event, 'reason', { value: new RangeError('zu weit') });
			window.dispatchEvent(event);
		} finally {
			stop();
		}
		expect(log.entries[0]).toMatchObject({
			intent: 'Unerwarteter Fehler',
			exception: { name: 'RangeError', message: 'zu weit' }
		});
	});

	it('leaves out noise and stops listening when asked', () => {
		const log = new ProblemLog(sessionStorage);
		const stop = watchUnexpectedErrors(window, log);
		window.dispatchEvent(
			new ErrorEvent('error', {
				message: 'ResizeObserver loop completed with undelivered notifications.'
			})
		);
		window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
		stop();
		window.dispatchEvent(new ErrorEvent('error', { message: 'x', error: new Error('später') }));
		expect(log.count).toBe(0);
	});

	it('survives a reload: what the window reported stays in the list of the tab', () => {
		const log = new ProblemLog(sessionStorage);
		const stop = watchUnexpectedErrors(window, log);
		window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
		stop();
		expect(new ProblemLog(sessionStorage).entries[0]?.exception?.message).toBe('boom');
	});
});
