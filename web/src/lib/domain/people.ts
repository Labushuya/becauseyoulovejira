// Display of persons (E2 plan, T-9). `users` is readable only for the own record, so authors
// and actors are shown relative to the signed-in user instead of by name.

export const SELF_LABEL = 'Du';
export const SYSTEM_LABEL = 'System';
export const OTHER_LABEL = 'Anderes Konto';

/**
 * Label of an author or actor: the own ID is "Du", an empty ID (system, superuser, automatic
 * changes) is "System", any other ID is "Anderes Konto" (only with households, revised there).
 */
export function personLabel(userId: string, selfId: string | null): string {
	if (userId === '') return SYSTEM_LABEL;
	return userId === selfId ? SELF_LABEL : OTHER_LABEL;
}
