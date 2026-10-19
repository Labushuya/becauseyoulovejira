import PocketBase, { type SendOptions } from 'pocketbase';
import { noteRequest } from './data/errors';

/**
 * Every request of the SDK goes through `send`. A failed one notes its method and its path for
 * "Details" of the message (FP-1, ADR-0071): an error of the SDK carries the address only for an
 * answer and never the method, and for a missing connection nothing at all. Only the path is
 * kept (the data layer strips the query); body, headers and the token stay out.
 */
class AppPocketBase extends PocketBase {
	override async send<T>(path: string, options: SendOptions): Promise<T> {
		try {
			return await super.send<T>(path, options);
		} catch (error) {
			noteRequest(error, options.method ?? 'GET', path);
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
