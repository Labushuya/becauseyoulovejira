// What a row of the ticket table needs to edit its cells in place (plan BI-3, ADR-0036 §6). The
// table builds it from the list store and the catalog; without it the cells only show their value.

import type { ProjectRef, TagRef, TicketPatch } from '$lib/domain/ticket';
import type { EnsureTagResult } from '$lib/stores/catalog.svelte';

export interface RowEdit {
	/** Projects that can be chosen: the active ones in tree order (ADR-0034). */
	projects: readonly ProjectRef[];
	/** Every tag (the catalog). */
	tags: readonly TagRef[];
	/** A save of this ticket runs. */
	busy: boolean;
	/** Saves the changed fields; resolves to false when the server refused. */
	save(patch: TicketPatch): Promise<boolean>;
	/** An existing tag for a typed name, or a new one. */
	createTag(name: string): Promise<EnsureTagResult>;
}
