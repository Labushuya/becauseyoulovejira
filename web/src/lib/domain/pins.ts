// Pinned tickets (PIN-1, ADR-0064). Pure: the order of the pins, the pinned tickets a list knows,
// the texts and the folded section "Angeheftet" on this device.
//
// A pin belongs to one account (collection ticket_pins: user, ticket, created); the same ticket may
// be pinned by several members of a household, each sees only the own pins. The section shows the
// pinned tickets in the order of pinning, oldest first, and only those the list store of the tab
// knows: the open tickets of its area (ADR-0059). Completing a ticket or moving it to the trash
// releases every pin of it on the server.

/** One own pin. */
export interface TicketPin {
	/** ID of the row of ticket_pins. */
	id: string;
	/** The pinned ticket. */
	ticket: string;
	/** Moment of pinning in the format of the server; orders the section, oldest first. */
	created: string;
}

/** Name of the section and of the list of the pins of a project. */
export const PINNED_SECTION = 'Angeheftet';

/** Tooltips of the toggle: what a click does. */
export const PIN_TOOLTIPS = Object.freeze({ pin: 'Anheften', unpin: 'Lösen' });

/** Texts of the refusals of the hook (lib/pin-rules.js), the same as there. */
export const TICKET_PIN_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_pin_done: 'Erledigte Tickets lassen sich nicht anheften.'
});

/** Key of the folded section "Angeheftet" in localStorage: only '1'; unfolding removes it. */
export const PINNED_FOLDED_KEY = 'byl-pinned-folded';

/** Order of the section: the moment of pinning, oldest first; the ID keeps equal moments stable. */
export function comparePins(a: TicketPin, b: TicketPin): number {
	if (a.created !== b.created) return a.created < b.created ? -1 : 1;
	if (a.id !== b.id) return a.id < b.id ? -1 : 1;
	return 0;
}

/** The pinned ticket IDs in the order of the section, each once. */
export function pinnedTicketIds(pins: Iterable<TicketPin>): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const pin of [...pins].sort(comparePins)) {
		if (seen.has(pin.ticket)) continue;
		seen.add(pin.ticket);
		ids.push(pin.ticket);
	}
	return ids;
}

/**
 * The pinned tickets `find` knows, in the order of `ids` (pinnedTicketIds). With the list store of
 * the tab as `find` these are the open pinned tickets of its area: the section "Angeheftet", the pins
 * of a project and the suggestions of a daily plan take them the same way.
 */
export function pinnedTickets<T>(
	ids: readonly string[],
	find: (id: string) => T | null | undefined
): T[] {
	const tickets: T[] = [];
	for (const id of ids) {
		const ticket = find(id);
		if (ticket !== null && ticket !== undefined) tickets.push(ticket);
	}
	return tickets;
}

/** Name of the toggle; it stays the same, `aria-pressed` says whether the ticket is pinned. */
export function pinToggleLabel(key: string): string {
	return `${key} anheften`;
}

/** Number of pinned tickets beside the number of a list: "+ 2 angeheftet". */
export function pinnedMoreText(count: number): string {
	return `+ ${count} angeheftet`;
}

/** Number of tickets in the section for screen readers. */
export function pinnedCountText(count: number): string {
	return count === 1 ? '1 Ticket' : `${count} Tickets`;
}

/** Title of the flag of a failed toggle. */
export function pinFailedText(key: string, pinned: boolean): string {
	return pinned ? `${key} ließ sich nicht lösen.` : `${key} ließ sich nicht anheften.`;
}

/** Name of the list of the pins of a project. */
export function projectPinsLabel(name: string): string {
	return `Angeheftet in „${name}“`;
}

/** Whether the section "Angeheftet" is folded on this device; a blocked storage keeps it open. */
export function readPinnedFolded(storage: Pick<Storage, 'getItem'> | null): boolean {
	try {
		return storage?.getItem(PINNED_FOLDED_KEY) === '1';
	} catch {
		return false;
	}
}

/** Remembers the folded section on this device; a blocked storage keeps it for this page only. */
export function writePinnedFolded(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	folded: boolean
): void {
	try {
		if (folded) storage?.setItem(PINNED_FOLDED_KEY, '1');
		else storage?.removeItem(PINNED_FOLDED_KEY);
	} catch {
		// Private mode or a full storage: the section stays as it is on this page.
	}
}
