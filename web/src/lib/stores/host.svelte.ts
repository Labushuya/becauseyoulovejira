// Operating system of the server for the guides (ADR-0028, plan plattformen S0-3). The (app) layout
// creates the store, loads the platform once after sign-in and puts it into the context; the note
// above the Windows guides reads it. Until the answer arrives, and outside the layout, it is Windows.

import { createContext } from 'svelte';
import { DEFAULT_HOST_PLATFORM, type HostPlatform } from '$lib/domain/host-platform';

/** Loads the platform; never fails (the data layer answers Windows on errors). */
export type HostPlatformSource = (signal: AbortSignal) => Promise<HostPlatform>;

export class HostStore {
	#platform = $state<HostPlatform>(DEFAULT_HOST_PLATFORM);
	readonly #source: HostPlatformSource;

	constructor(source: HostPlatformSource) {
		this.#source = source;
	}

	get platform(): HostPlatform {
		return this.#platform;
	}

	/** Loads the platform; the answer of an aborted request is dropped. */
	async load(signal: AbortSignal): Promise<void> {
		const platform = await this.#source(signal);
		if (!signal.aborted) this.#platform = platform;
	}
}

const [getHostStore, setHostStore, hasHostStore] = createContext<HostStore>();

/** The store of the (app) layout, or null outside it (tests of single pages and components). */
export function findHostStore(): HostStore | null {
	return hasHostStore() ? getHostStore() : null;
}

export { setHostStore };
