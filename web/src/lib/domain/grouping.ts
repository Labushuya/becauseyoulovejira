// Grouping of the open tickets (E3 plan, T-7; ADR-0013 section 1). Pure.

/** Available groupings; no grouping is expressed by the absence of one. */
export const GROUPINGS = ['status', 'priority', 'project', 'due'] as const;
export type Grouping = (typeof GROUPINGS)[number];
