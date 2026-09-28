// How a ticket opens (plan "Bulk, Inline und Ansicht", BI-1; ADR-0036 §1): in the side panel
// (default) or in the full view, like Jira remembers the last choice. The choice is a preference of
// this device, kept in localStorage; only "full" is stored, the default removes the key (like
// `byl-transparency`). Pure module: reading and writing the stored value.

export type OpenMode = 'panel' | 'full';

/** localStorage key; the only stored value is "full". */
export const OPEN_MODE_STORAGE_KEY = 'byl-ticket-open';

/** The stored value read strictly: only "full" counts, anything else is the default panel. */
export function parseOpenMode(raw: string | null | undefined): OpenMode {
	return raw === 'full' ? 'full' : 'panel';
}

/** The value to store, or null to remove the key (default). */
export function serializeOpenMode(mode: OpenMode): string | null {
	return mode === 'full' ? 'full' : null;
}

/**
 * The mode a link uses: the full view only where the panel is embedded (from 64rem). Below that the
 * panel lies over the list, and a link keeps opening it there as before; the stored choice stays.
 */
export function effectiveOpenMode(mode: OpenMode, wide: boolean): OpenMode {
	return wide ? mode : 'panel';
}
