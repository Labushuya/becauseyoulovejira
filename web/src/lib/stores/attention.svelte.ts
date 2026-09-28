// Hint in an open tab (ADR-0035 section 5; plan start-fenster, SF-3): start.bat, the landing page
// or a second tab of the same browser opened the app again, or stop.bat ended it. A message of
// the server is confirmed first (ack, so start.bat opens no second tab), then the tab shows an
// info flag and, while hidden, blinks its title. "Beendet" stays until the connection is back
// (or the user closes it) and needs no ack: stop.bat does not wait.

import type PocketBase from 'pocketbase';
import {
	subscribeAttention,
	type AttentionMessage,
	type AttentionReason
} from '$lib/data/attention';
import { onReconnect } from '$lib/data/realtime';
import { APP_OPENED_AGAIN, APP_STOPPED } from '$lib/guidance/texts';
import { hold, type Unsubscribe } from './realtime';
import type { FlagSink } from './flags.svelte';

export interface AttentionSource {
	attention(onMessage: (message: AttentionMessage) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function attentionSource(pb: PocketBase): AttentionSource {
	return {
		attention: (onMessage) => subscribeAttention(pb, onMessage),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

export interface AttentionDeps {
	ack(nonce: string): Promise<unknown>;
	flags: FlagSink;
	/** Blinks the title while the tab is hidden (TitleBlinker). */
	blink(): void;
	/** Windows notification if the user switched it on (NotifyStore, SF-6). */
	notify?(): void;
}

export class AttentionStore {
	readonly #deps: AttentionDeps;
	#againFlag: string | null = null;
	#stopFlag: string | null = null;

	constructor(deps: AttentionDeps) {
		this.#deps = deps;
	}

	/** A message of the server: ack first (not for "stop"), then the hint. */
	receive(message: AttentionMessage): void {
		if (message.reason !== 'stop') {
			void this.#deps.ack(message.nonce).catch(() => undefined);
		}
		this.show(message.reason);
	}

	/** The hint alone, also for another tab of this browser (no server involved). */
	show(reason: AttentionReason): void {
		const { flags } = this.#deps;
		if (reason === 'stop') {
			if (this.#stopFlag !== null) return;
			this.#stopFlag = flags.show({
				tone: 'info',
				title: APP_STOPPED.title,
				description: APP_STOPPED.description,
				duration: null,
				onclose: () => {
					this.#stopFlag = null;
				}
			});
			return;
		}
		// Back in business: a "beendet" flag no longer fits.
		if (this.#stopFlag !== null) flags.dismiss(this.#stopFlag);
		if (this.#againFlag !== null) flags.dismiss(this.#againFlag);
		const id = flags.show({
			tone: 'info',
			title: APP_OPENED_AGAIN.title,
			description: APP_OPENED_AGAIN.description,
			onclose: () => {
				if (this.#againFlag === id) this.#againFlag = null;
			}
		});
		this.#againFlag = id;
		this.#deps.blink();
		this.#deps.notify?.();
	}

	/** The connection is back after an interruption: the app runs again. */
	reconnected(): void {
		if (this.#stopFlag !== null) this.#deps.flags.dismiss(this.#stopFlag);
	}

	/** Subscribes to the messages and reconnections; the returned stop ends both. */
	connect(source: AttentionSource): () => void {
		const stopMessages = hold(source.attention((message) => this.receive(message)));
		const stopReconnect = hold(source.reconnected(() => this.reconnected()));
		return () => {
			stopMessages();
			stopReconnect();
		};
	}
}
