// The current time for texts like "vor 5 Min." on the channel cards (plan kanal-karten KK-2):
// a state that follows the clock while the component that asked for it is mounted. Only the
// display ticks; nothing is fetched (CLAUDE.md §7, no polling).

/** Default step: twice a minute, so "vor 5 Min." is never more than half a minute late. */
export const CLOCK_STEP_MS = 30_000;

/**
 * Starts a clock for the calling component; call it while the component initialises. `now`
 * follows the time in steps of `step` milliseconds and stops with the component.
 */
export function minuteClock(step = CLOCK_STEP_MS): { readonly now: number } {
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), step);
		return () => clearInterval(timer);
	});
	return {
		get now() {
			return now;
		}
	};
}
