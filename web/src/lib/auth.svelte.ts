import PocketBase, { ClientResponseError, type AuthRecord } from 'pocketbase';
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
 * network: no response from the server.
 */
export type LoginFailure = 'rejected' | 'network';

export type LoginResult = { ok: true } | { ok: false; failure: LoginFailure };

const USERS = 'users';

function statusOf(error: unknown): number | undefined {
	return error instanceof ClientResponseError ? error.status : undefined;
}

/**
 * Session state of the app as runes, fed by `authStore.onChange` (login, logout, refresh and
 * changes from other tabs through the LocalAuthStore). The token itself stays in the store.
 */
export class Auth {
	readonly #client: PocketBase;
	#restoring: Promise<void> | null = null;

	#status = $state<SessionStatus>('checking');
	#failure = $state<SessionFailure | null>(null);
	#busy = $state(false);
	#hasToken = $state(false);
	#record = $state.raw<AuthRecord>(null);

	#loggedIn = $derived(this.#hasToken && this.#record !== null);
	#email = $derived(typeof this.#record?.email === 'string' ? this.#record.email : '');

	constructor(client: PocketBase) {
		this.#client = client;
		this.#sync();
		client.authStore.onChange(() => this.#sync());
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
			return { ok: false, failure: statusOf(error) === 0 ? 'network' : 'rejected' };
		}
		this.#settle('ready', null);
		return { ok: true };
	}

	logout(): void {
		this.#client.authStore.clear();
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
			if (status === 401 || status === 403) {
				this.#client.authStore.clear();
				this.#settle('ready', null);
			} else {
				this.#settle('unreachable', status === 0 ? 'network' : 'server');
			}
		} finally {
			this.#busy = false;
		}
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
