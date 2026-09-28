// Health of the realtime subscriptions (ADR-0007, ADR-0011 E6, E2 plan §8): counts the
// subscriptions that failed and are being tried again by `hold` (realtime.ts). While one is
// down, the app layout shows the hint "Live-Aktualisierung unterbrochen". One instance for the
// app, like the realtime connection of the SDK it describes.

export class LiveHealth {
	#down = $state(0);

	/** At least one subscription failed and waits for its next attempt. */
	get interrupted(): boolean {
		return this.#down > 0;
	}

	/** A subscription failed (first failure of a row of attempts). */
	interrupt(): void {
		this.#down += 1;
	}

	/** A failed subscription is set up again or no longer wanted. */
	resume(): void {
		if (this.#down > 0) this.#down -= 1;
	}
}

export const liveHealth = new LiveHealth();
