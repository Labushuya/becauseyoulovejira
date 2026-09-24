// Tags (E3 plan, T-14). Pure.

import type { TagRef } from './ticket';

/** Length limit of tags.name (tests/unit/web-limits.test.mjs keeps it equal to the schema). */
export const TAG_NAME_MAX_LENGTH = 50;

/** Tag of the catalog: the reference plus `updated`, so older events can be ignored. */
export interface Tag extends TagRef {
	/** UTC timestamp of PocketBase; sorts as text. */
	updated: string;
}
