import PocketBase, { type SendOptions } from 'pocketbase';
import { noteRequest } from './data/errors';

/**
 * What a request tells the monitor of the connection (OF-2, ADR-0074 §9): an answer of the server
 * (any status), or none at all (status 0 without an abort).
 */
export type RequestOutcome = 'answer' | 'network';

let observer: ((outcome: RequestOutcome) => void) | null = null;

/**
 * Lets the monitor of the connection watch every request (lib/offline/connectivity.svelte.ts); null
 * stops it. Only while the outbox can work; otherwise no request is watched.
 */
export function observeRequests(next: ((outcome: RequestOutcome) => void) | null): void {
	observer = next;
}

function isAbort(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const record = error as { isAbort?: unknown; name?: unknown };
	return record.isAbort === true || record.name === 'AbortError';
}

function statusOf(error: unknown): number | null {
	if (typeof error !== 'object' || error === null) return null;
	const status = (error as { status?: unknown }).status;
	return typeof status === 'number' ? status : null;
}

/**
 * Every request of the SDK goes through `send`. A failed one notes its method and its path for
 * "Details" of the message (FP-1, ADR-0071): an error of the SDK carries the address only for an
 * answer and never the method, and for a missing connection nothing at all. Only the path is
 * kept (the data layer strips the query); body, headers and the token stay out. While the outbox
 * can work, the monitor of the connection hears whether the server answered (OF-2).
 */
class AppPocketBase extends PocketBase {
	override async send<T>(path: string, options: SendOptions): Promise<T> {
		try {
			const result = await super.send<T>(path, options);
			observer?.('answer');
			return result;
		} catch (error) {
			noteRequest(error, options.method ?? 'GET', path);
			if (observer !== null && !isAbort(error)) {
				observer(statusOf(error) === 0 ? 'network' : 'answer');
			}
			throw error;
		}
	}
}

/**
 * The only PocketBase client of the app. PocketBase serves the SPA itself, so the API is on the
 * same origin and '/' keeps every request relative (no hard-coded host, ADR-0001). The default
 * LocalAuthStore keeps the session in localStorage, so it survives a reload.
 *
 * Auto-cancellation is off. By default the SDK aborts a pending request as soon as another one
 * with the same method and path starts: two views loading the same list would fail at random,
 * and the aborted request (status 0) would look like a network error. Code that has to drop
 * stale requests passes its own AbortController signal instead.
 */
export const pb: PocketBase = new AppPocketBase('/');
pb.autoCancellation(false);
