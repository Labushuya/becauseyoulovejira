import PocketBase, { ClientResponseError, isTokenExpired, type AuthRecord } from 'pocketbase';
import { adminOf } from '$lib/domain/accounts';
import { pb } from '$lib/pocketbase';

/**
 * checking: the stored session is being verified; ready: the session state is known
 * (logged in or not); unreachable: the check failed, the stored session is kept.
 */
export type SessionStatus = 'checking' | 'ready' | 'unreachable';

/** network: no response from the server; server: an unexpected error response (e.g. 5xx). */
export type SessionFailure = 'network' | 'server';

/**
 * rejected: the server refused the login. Wrong password, unknown e-mail and every other
 * refusal share one outcome, so the UI cannot reveal whether an account exists.
 * rate_limited: too many attempts (429). server: an error response of the server (5xx).
 * Neither depends on the account, so they reveal nothing about an e-mail address (E2 plan, T-18).
 * network: no response from the server. disabled: the right password of an account the
 * administrator disabled (403, ADR-0056 §3); it comes only after the right password, so it reveals
 * nothing to someone guessing.
 */
export type LoginFailure = 'rejected' | 'rate_limited' | 'server' | 'network' | 'disabled';

export type LoginResult = { ok: true } | { ok: false; failure: LoginFailure };

const USERS = 'users';

/** Keep-alive cadence while the app layout is shown (ADR-0007 section 1). */
export const KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000;
/** A token that expires within this many seconds is renewed by the keep-alive. */
export const RENEW_THRESHOLD_SECONDS = 24 * 60 * 60;

function statusOf(error: unknown): number | undefined {
	return error instanceof ClientResponseError ? error.status : undefined;
}

function loginFailureOf(status: number | undefined): LoginFailure {
	if (status === 0) return 'network';
	if (status === 429) return 'rate_limited';
	if (status === 403) return 'disabled';
	if (status !== undefined && status >= 500) return 'server';
	return 'rejected';
}

/**
 * A custom topic only to send the subscriptions of this tab again with the current token: the
 * server binds the realtime connection to the account of that request (see #rebindRealtime).
 */
const REBIND_TOPIC = 'byl/session';

function endsSession(status: number | undefined): boolean {
	return status === 401 || status === 403;
}

/**
 * Session state of the app as runes, fed by `authStore.onChange` (login, logout, refresh and
 * changes from other tabs through the LocalAuthStore). The token itself stays in the store.
 */
export class Auth {
	readonly #client: PocketBase;
	#restoring: Promise<void> | null = null;
	#renewing: Promise<void> | null = null;

	#status = $state<SessionStatus>('checking');
	#failure = $state<SessionFailure | null>(null);
	#busy = $state(false);
	#hasToken = $state(false);
	#record = $state.raw<AuthRecord>(null);

	#loggedIn = $derived(this.#hasToken && this.#record !== null);
	#email = $derived(typeof this.#record?.email === 'string' ? this.#record.email : '');
	#name = $derived(typeof this.#record?.name === 'string' ? this.#record.name : '');
	#admin = $derived(adminOf(this.#record));
	#userId = $derived(
		typeof this.#record?.id === 'string' && this.#record.id !== '' ? this.#record.id : null
	);

	constructor(client: PocketBase) {
		this.#client = client;
		this.#sync();
		let token = client.authStore.token;
		client.authStore.onChange(() => {
			const hadToken = this.#hasToken;
			const before = { token, userId: this.#userId };
			this.#sync();
			token = client.authStore.token;
			// The session ended elsewhere (other tab, expired or revoked token): stop the realtime
			// subscriptions as well, so none keeps running without permission (ADR-0007 section 2).
			if (hadToken && !this.#hasToken) this.#stopRealtime();
			else if (
				before.token !== '' &&
				token !== '' &&
				token !== before.token &&
				before.userId === this.#userId
			) {
				this.#rebindRealtime();
			}
		});
	}

	get status(): SessionStatus {
		return this.#status;
	}

	/** Why the last session check failed; null unless the status is "unreachable". */
	get failure(): SessionFailure | null {
		return this.#failure;
	}

	/** True while a session check is running, including a retry from "unreachable". */
	get busy(): boolean {
		return this.#busy;
	}

	get isLoggedIn(): boolean {
		return this.#loggedIn;
	}

	get email(): string {
		return this.#email;
	}

	/** Display name of the signed-in account ('' without one). */
	get name(): string {
		return this.#name;
	}

	/**
	 * Whether the signed-in account is the administrator of the app (ADR-0056 §7): it sees the pages
	 * Konten, Sicherheit, Sicherung, Speicher and System and sets up channels with access data. The
	 * server decides on every route; this only leaves out what it would refuse.
	 */
	get isAdmin(): boolean {
		return this.#loggedIn && this.#admin;
	}

	/** Record ID of the signed-in user, null without a session (authors and actors, T-9). */
	get userId(): string | null {
		return this.#loggedIn ? this.#userId : null;
	}

	/**
	 * Verifies a stored session once at app start and on "retry". `authRefresh` also extends the
	 * session (OF-18). 401/403 end the session; any other failure keeps it, so a server that is
	 * down does not log the user out. Concurrent calls share one request.
	 */
	restore(): Promise<void> {
		this.#restoring ??= this.#refresh().finally(() => {
			this.#restoring = null;
		});
		return this.#restoring;
	}

	async login(email: string, password: string): Promise<LoginResult> {
		try {
			await this.#client.collection(USERS).authWithPassword(email, password);
		} catch (error) {
			return { ok: false, failure: loginFailureOf(statusOf(error)) };
		}
		this.#settle('ready', null);
		return { ok: true };
	}

	/**
	 * Ends the session. The realtime subscriptions stop first, then the store is cleared
	 * (ADR-0007 section 2): no subscription keeps running without permission, and a later login
	 * of another user does not hit the 403 of the old connection.
	 */
	logout(): void {
		this.#stopRealtime();
		this.#client.authStore.clear();
	}

	/**
	 * Check before every data request (ADR-0006 section 4): true if the stored token is still
	 * valid. An expired token ends the session without a request, so the route guard leads to the
	 * login with a redirect instead of the list rules answering with empty lists.
	 */
	ensureValid(): boolean {
		if (this.#client.authStore.token === '') return false;
		if (this.#client.authStore.isValid) return true;
		this.logout();
		return false;
	}

	/**
	 * Keeps the session alive while the app layout is shown (ADR-0007 section 1): checks now,
	 * every 30 minutes, when the tab becomes visible again and when the browser goes online.
	 * Returns the cleanup for the layout's `$effect`.
	 */
	keepAlive(): () => void {
		const check = () => void this.renew();
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') check();
		};
		check();
		const timer = setInterval(check, KEEP_ALIVE_INTERVAL_MS);
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('online', check);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('online', check);
		};
	}

	/**
	 * One keep-alive step: an expired token ends the session, a token expiring within 24 hours
	 * is renewed with `authRefresh`. 401/403 end the session; network and server errors keep
	 * it, the next occasion tries again. Never switches the status to "checking", so the page
	 * stays in place. Concurrent calls share one request.
	 */
	renew(): Promise<void> {
		if (!this.ensureValid()) return Promise.resolve();
		if (!isTokenExpired(this.#client.authStore.token, RENEW_THRESHOLD_SECONDS)) {
			return Promise.resolve();
		}
		this.#renewing ??= this.#client
			.collection(USERS)
			.authRefresh()
			.then(
				() => undefined,
				(error: unknown) => {
					if (endsSession(statusOf(error))) this.logout();
				}
			)
			.finally(() => {
				this.#renewing = null;
			});
		return this.#renewing;
	}

	async #refresh(): Promise<void> {
		if (!this.#client.authStore.token) {
			this.#settle('ready', null);
			return;
		}
		this.#busy = true;
		try {
			await this.#client.collection(USERS).authRefresh();
			this.#settle('ready', null);
		} catch (error) {
			const status = statusOf(error);
			if (endsSession(status)) {
				this.#client.authStore.clear();
				this.#settle('ready', null);
			} else {
				this.#settle('unreachable', status === 0 ? 'network' : 'server');
			}
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * Removes all subscriptions synchronously; the SDK closes the connection in the next
	 * microtask without another request. Not awaited: a hanging subscription request must not
	 * block the logout, and a failure there changes nothing about the ended session.
	 */
	#stopRealtime(): void {
		this.#client.realtime.unsubscribe().catch(() => undefined);
	}

	/**
	 * A new token of the same account (a new password here or in another tab, ADR-0056 §3): the
	 * server dropped the account from this tab's realtime connection, because the old token is no
	 * longer valid. Every subscribe sends all subscriptions of the tab with the current token, so one
	 * short subscription binds the connection to the account again. Not awaited, failures stay quiet:
	 * a broken connection reconnects with the new token anyway.
	 */
	#rebindRealtime(): void {
		if (!this.#client.realtime.isConnected) return;
		this.#client.realtime
			.subscribe(REBIND_TOPIC, () => undefined)
			.then((unsubscribe) => unsubscribe())
			.catch(() => undefined);
	}

	#settle(status: SessionStatus, failure: SessionFailure | null): void {
		this.#status = status;
		this.#failure = failure;
	}

	#sync(): void {
		this.#hasToken = this.#client.authStore.token !== '';
		this.#record = this.#client.authStore.record;
	}
}

export const auth = new Auth(pb);
