// The trash in the area of the tab (E7-3, ADR-0059 §6): who may delete for good and where the
// retention is changed. In "Privat" both as before (the retention under "Einstellungen → Tickets");
// in a household only the owner and members with the right "purge" delete for good and change its
// retention on the page "Haushalt". The view and the preview of the trash read it; the server
// refuses everything else with 403 anyway.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import { purgeAllowed } from '$lib/domain/area';
import { HOUSEHOLD_TEXTS, mayPurge, meOf } from '$lib/domain/household';
import { findAreaStore } from '$lib/stores/area.svelte';
import { findHouseholdStore } from '$lib/stores/household.svelte';

export class TrashArea {
	readonly #area = findAreaStore();
	readonly #household = findHouseholdStore();
	#inHousehold = $derived(this.#area?.active === 'household');
	#canPurge = $derived.by(() => {
		const state = this.#household?.household ?? null;
		return purgeAllowed(
			this.#area?.active ?? 'private',
			state === null ? null : mayPurge(meOf(state))
		);
	});

	/** Whether "Endgültig löschen …" and "Papierkorb leeren …" are offered. */
	get canPurge(): boolean {
		return this.#canPurge;
	}

	/** Where the retention is changed, null when the user may not change it. */
	get retentionHref(): ResolvedPathname | null {
		if (!this.#inHousehold) return resolve('/einstellungen/tickets');
		return this.#canPurge ? resolve('/einstellungen/haushalt') : null;
	}

	/** Who may change the retention, shown instead of the link; null with the link. */
	get retentionNote(): string | null {
		return this.#inHousehold && !this.#canPurge ? HOUSEHOLD_TEXTS.retentionReadOnly : null;
	}
}
