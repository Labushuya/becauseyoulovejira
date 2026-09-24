// Number "gesamt" on the project tiles (E3 plan, T-12 and package 14; ADR-0013 section 5): the
// server counts the done tickets per project, the tile adds the tickets that are not done from
// the list store. The store lives only while the project view is shown; after ticket events
// (and after a reconnection) it counts again, debounced, so a burst of events costs one round.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { countDoneTickets } from '$lib/data/projects';
import { hold, type LiveSource } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

/** Pause after the last ticket event before the done tickets are counted again. */
export const STATS_DEBOUNCE_MS = 300;

/** Data access of the store; tests pass a fake, the app binds the data layer to its client. */
export interface ProjectStatsData {
	countDone(projectId: string, options: RequestOptions): Promise<number>;
}

export function projectStatsData(pb: PocketBase): ProjectStatsData {
	return { countDone: (projectId, options) => countDoneTickets(pb, projectId, options) };
}

export class ProjectStatsStore {
	readonly #data: ProjectStatsData;
	readonly #session: SessionGuard;

	/** Done tickets per project ID, as last counted. */
	readonly #done = new SvelteMap<string, number>();
	/** Projects whose tiles are shown. */
	#tracked: readonly string[] = [];
	#controller: AbortController | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;

	#error = $state<string | null>(null);

	constructor(data: ProjectStatsData, session: SessionGuard) {
		this.#data = data;
		this.#session = session;
	}

	/** Failure of the last count, null without one; the numbers counted before stay. */
	get error(): string | null {
		return this.#error;
	}

	/** Done tickets of a project, null until counted. */
	doneCount(projectId: string): number | null {
		return this.#done.get(projectId) ?? null;
	}

	/** "gesamt" (T-12): `active` tickets from the list store plus the done ones; null until counted. */
	total(projectId: string, active: number): number | null {
		const done = this.doneCount(projectId);
		return done === null ? null : done + active;
	}

	/**
	 * Projects whose tiles are shown (archived ones only with the switch). Counts at once if one of
	 * them has no number yet; numbers already counted stay visible meanwhile.
	 */
	track(projectIds: readonly string[]): void {
		this.#tracked = [...projectIds];
		if (projectIds.some((id) => !this.#done.has(id))) void this.#count();
	}

	/** Counts again after the pause STATS_DEBOUNCE_MS; a new call restarts the pause. */
	refresh(): void {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#count(), STATS_DEBOUNCE_MS);
	}

	/** Counts again at once ("Erneut versuchen"). */
	async reload(): Promise<void> {
		clearTimeout(this.#timer);
		await this.#count();
	}

	/**
	 * Counts again after every ticket event and after a reconnection (ADR-0007). Returns the
	 * cleanup, which ends the subscriptions and empties the store.
	 */
	connect(live: LiveSource): () => void {
		const stops = [
			hold(live.tickets(() => this.refresh())),
			hold(live.reconnected(() => this.refresh()))
		];
		return () => {
			for (const stop of stops) stop();
			this.reset();
		};
	}

	/** Aborts the timer and a running count and forgets every number. */
	reset(): void {
		clearTimeout(this.#timer);
		this.#controller?.abort();
		this.#controller = null;
		this.#tracked = [];
		this.#done.clear();
		this.#error = null;
	}

	/** Counts the done tickets of every tracked project; a newer count aborts an older one. */
	async #count(): Promise<void> {
		this.#controller?.abort();
		this.#controller = null;
		const ids = this.#tracked;
		if (ids.length === 0 || !this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const options = { signal: controller.signal };
		try {
			const counts = await Promise.all(ids.map((id) => this.#data.countDone(id, options)));
			if (controller.signal.aborted) return;
			ids.forEach((id, index) => this.#done.set(id, counts[index] ?? 0));
			this.#error = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#error = failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}
}
