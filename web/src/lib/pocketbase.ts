import PocketBase from 'pocketbase';

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
export const pb = new PocketBase('/');
pb.autoCancellation(false);
