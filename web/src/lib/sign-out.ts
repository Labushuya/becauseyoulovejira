// "Abmelden" of the header and of "Mehr" (OF-2, ADR-0074 addendum OF-2): the (app) layout owns the
// way out, because with kept changes of the outbox it first asks "Abmelden und 3 gemerkte
// Änderungen verwerfen?" (decision of the user 4). An ended session (expired token, 401, another tab)
// does not come here and keeps them. Without the layout (tests of single parts) the button signs out
// as before.

import { createContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';

/** Signs out and opens `target` (the login with the current page as redirect). */
export type SignOut = (target: ResolvedPathname) => void;

const [getSignOut, setSignOut, hasSignOut] = createContext<SignOut>();

/** The way out of the layout, null outside of it. */
export function findSignOut(): SignOut | null {
	return hasSignOut() ? getSignOut() : null;
}

export { setSignOut };
