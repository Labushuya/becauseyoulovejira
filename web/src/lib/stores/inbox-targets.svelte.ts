// Target projects of the cards without a connection on the page "Kanäle" (ADR-0049): the own
// inbox, WhatsApp Web and the files. Loaded when the page opens, like the keywords of these cards
// (import-keywords.svelte.ts); every change saves all targets of the user at once. Before the
// migration 1790203100 the server does not know the field, and the cards show the restart hint.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import { getInboxTargets, saveInboxTargets } from '$lib/data/inbox-targets';
import type { RequestOptions } from '$lib/data/options';
import {
	EMPTY_TARGETS,
	targetSavedText,
	type InboxTargets,
	type TargetCard
} from '$lib/domain/target-project';
import type { ProjectRef } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface InboxTargetsData {
	load(options: RequestOptions): Promise<InboxTargets | null>;
	save(targets: InboxTargets): Promise<InboxTargets>;
}

export function inboxTargetsData(pb: PocketBase): InboxTargetsData {
	return {
		load: (options) => getInboxTargets(pb, options),
		save: (targets) => saveInboxTargets(pb, targets)
	};
}

export class InboxTargetsStore {
	readonly #data: InboxTargetsData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	#controller: AbortController | null = null;

	#state = $state<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	#error = $state<string | null>(null);
	#targets = $state<InboxTargets>(EMPTY_TARGETS);

	constructor(data: InboxTargetsData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state() {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	get targets(): InboxTargets {
		return this.#targets;
	}

	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const targets = await this.#data.load({ signal: controller.signal });
			if (targets === null) {
				this.#state = 'unavailable';
				return;
			}
			this.#targets = targets;
			this.#state = 'ready';
			this.#error = null;
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#state = 'error';
			this.#error = failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * Saves the target of one card (`name` names the card in the flag); answers null or the text of
	 * the failure, which stays at the field. The same project again sends nothing.
	 */
	async save(card: TargetCard, project: ProjectRef | null, name: string): Promise<string | null> {
		const projectId = project?.id ?? '';
		if (this.#targets[card] === projectId) return null;
		if (!this.#session.ensureValid()) return null;
		try {
			this.#targets = await this.#data.save({ ...this.#targets, [card]: projectId });
			this.#flags.show({ tone: 'success', title: targetSavedText(name, project) });
			return null;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			const fields = Object.values(failure.fields);
			return fields.length > 0 ? (fields[0]?.message ?? failure.message) : failure.message;
		}
	}

	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#state = 'idle';
		this.#error = null;
		this.#targets = EMPTY_TARGETS;
	}
}
