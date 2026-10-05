// "Aufgaben" shows only open work since ER-1 (ADR-0066 §5): an address from before that asked for
// done tickets (the switch `erledigte=1`, the status filter "Erledigt") leads to the view
// "Erledigte" with the filters both know, or loses the switch where it changed nothing. In the SPA
// the redirect runs in the client, before the list loads.

import { redirect } from '@sveltejs/kit';
import { legacyDoneHref } from '$lib/ticket-links';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = ({ url }) => {
	const target = legacyDoneHref(url);
	if (target !== null) redirect(307, target);
};
