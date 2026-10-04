// Context of the app in this tab (KOB-1, ADR-0057): one store for the whole tab, like the session.
// The (app) layout and the Notfallkarte start it with the data layer and the auth store of the SDK:
// it loads the context after the sign-in and after every refresh of the session, starts over for
// another account and goes back to the most restrictive view on sign-out and when the page goes.
// A refusal with "loopback", "owner" or "platform" asks again, and so does every reconnection of the
// realtime connection in the app layout (the restart after an update). While nothing is known, the
// tab shows nothing of the administrator and no command; a failed request keeps what the tab had.
// Texts outside components read the same capabilities through currentCapabilities of
// lib/data/context.ts.

import { onContextRefusal, provideCapabilities, type ContextAnswer } from '$lib/data/context';
import {
	OUTDATED_CONTEXT,
	PENDING_CONTEXT,
	capabilitiesOf,
	type Capabilities,
	type ContextState
} from '$lib/domain/context';
import { hold, type LiveSource } from './realtime';

/** Loads the context; never fails (lib/data/context.ts). */
export type ContextSource = (signal: AbortSignal) => Promise<ContextAnswer>;

/** What the store needs of the realtime connection: the live source of the app layout fits. */
export type ContextConnection = Pick<LiveSource, 'reconnected'>;

/** What the store needs of the session: the auth store of the SDK fits. */
export interface ContextSession {
	readonly token: string;
	readonly record: { id?: unknown } | null;
	/** Calls back on every sign-in, refresh and sign-out; returns the end of the listening. */
	onChange(callback: () => void): () => void;
}

function idOf(record: { id?: unknown } | null): string | null {
	return typeof record?.id === 'string' && record.id !== '' ? record.id : null;
}

export class ContextStore {
	#state = $state.raw<ContextState>(PENDING_CONTEXT);
	readonly #capabilities = $derived(capabilitiesOf(this.#state));
	#source: ContextSource | null = null;
	#controller: AbortController | null = null;
	#token = '';
	#userId: string | null = null;
	#generation = 0;

	get state(): ContextState {
		return this.#state;
	}

	/** What this tab shows (lib/domain/context.ts). */
	get capabilities(): Capabilities {
		return this.#capabilities;
	}

	/**
	 * Follows the session with `source`: loads now with a session, again after every sign-in and
	 * refresh, and starts over for another account. With `connection` it loads again after every
	 * reconnection while there is a session. Returns the end, which goes back to the most
	 * restrictive view.
	 */
	start(
		source: ContextSource,
		session: ContextSession,
		connection?: ContextConnection
	): () => void {
		// A later start (another page outside the app layout) takes over; the end of an earlier one
		// then only stops its own listening.
		const generation = ++this.#generation;
		this.#source = source;
		this.#token = '';
		this.#userId = null;
		const follow = () => {
			if (generation !== this.#generation) return;
			const token = session.token;
			const userId = idOf(session.record);
			if (token === '' || userId === null) {
				this.#token = '';
				this.#userId = null;
				this.reset();
				return;
			}
			if (userId !== this.#userId) this.reset();
			const changed = token !== this.#token || userId !== this.#userId;
			this.#token = token;
			this.#userId = userId;
			if (changed) void this.refresh();
		};
		follow();
		const stopSession = session.onChange(follow);
		const stopRefusals = onContextRefusal(() => {
			if (generation === this.#generation) void this.refresh();
		});
		// The server is back after an interruption, above all the restart after an update: a tab
		// that got 404 or no answer before would otherwise keep the most restrictive view.
		const again = () => {
			if (generation === this.#generation && this.#token !== '') void this.refresh();
		};
		const stopReconnect = connection
			? hold((guard) => connection.reconnected(guard(again)), { recovered: again })
			: () => undefined;
		return () => {
			stopSession();
			stopRefusals();
			stopReconnect();
			if (generation !== this.#generation) return;
			this.#source = null;
			this.#token = '';
			this.#userId = null;
			this.reset();
		};
	}

	/** Loads the context again; the state stays until the answer, a failure keeps it. */
	async refresh(): Promise<void> {
		const source = this.#source;
		if (source === null) return;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const answer = await source(controller.signal);
		if (controller.signal.aborted || this.#controller !== controller) return;
		this.#controller = null;
		if (answer.kind === 'ready') this.#state = { kind: 'ready', context: answer.context };
		else if (answer.kind === 'outdated') this.#state = OUTDATED_CONTEXT;
	}

	/** Back to the most restrictive view; a running request is dropped. */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#state = PENDING_CONTEXT;
	}
}

/** The context of this tab. */
export const appContext = new ContextStore();

provideCapabilities(() => appContext.capabilities);
