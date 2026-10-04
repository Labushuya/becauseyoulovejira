// Display of persons (E2 plan, T-9; since E7-1 with names, ADR-0056 §4). Authors and actors are
// shown relative to the signed-in user: the own account is "Du", no account is "System". Another
// account shows its name once the signed-in account may see it (the same household, or the
// administrator of the app); without a visible name it stays "Anderes Konto".

export const SELF_LABEL = 'Du';
export const SYSTEM_LABEL = 'System';
export const OTHER_LABEL = 'Anderes Konto';

/** ID and display name of a visible account ('' without a name). */
export interface PersonName {
	id: string;
	name: string;
}

/** Where the names of visible accounts come from (the store of the (app) layout, or a test). */
export interface PersonNames {
	/** Name of an account, or null if it is not visible or has no name. */
	nameOf(id: string): string | null;
}

/**
 * Label of an author or actor: the own ID is "Du", an empty ID (system, superuser, automatic
 * changes) is "System", another ID its name if `names` knows one, else "Anderes Konto".
 */
export function personLabel(
	userId: string,
	selfId: string | null,
	names: PersonNames | null = null
): string {
	if (userId === '') return SYSTEM_LABEL;
	if (userId === selfId) return SELF_LABEL;
	const name = names?.nameOf(userId)?.trim() ?? '';
	return name === '' ? OTHER_LABEL : name;
}
