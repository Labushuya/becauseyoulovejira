// Addresses of links in the editor (plan editor RT-4, CLAUDE.md section 7): only http, https and
// mailto, like the display allows, and since AL-2 links to a ticket of the app (ADR-0042 section 5).
// Pure: "www.example.com" becomes https, "anna@example.com" mailto; everything else with a scheme
// or with blanks is refused with a sentence for the field.

export type LinkCheck = { href: string } | { error: string };

export const LINK_EMPTY = 'Bitte eine Adresse eingeben.';
export const LINK_NOT_ALLOWED = 'Nur Adressen mit http://, https:// oder mailto: sind möglich.';
export const LINK_INVALID = 'Das ist keine gültige Adresse.';

/**
 * Link to a ticket of the app (ADR-0042 section 5): exactly `/tickets/<record ID>`, the only
 * address without a scheme that editor and display take. It does not depend on port or host and
 * opens in the app itself.
 */
export const TICKET_LINK = /^\/tickets\/[a-z0-9]{15}$/;

const ALLOWED = /^(?:https?:\/\/|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const HOST = /^[^\s/:@]+\.[^\s/:@]+(?:[/?#]\S*)?$/;

/** Address of the link to a ticket. */
export function ticketLinkHref(id: string): string {
	return `/tickets/${id}`;
}

/** The record ID of a stored link to a ticket (`/tickets/<id>`), null for any other address. */
export function ticketIdOfLink(href: string | null): string | null {
	return href !== null && TICKET_LINK.test(href) ? href.slice('/tickets/'.length) : null;
}

/** The address to store for what the user typed, or why it cannot be a link. */
export function checkLink(input: string): LinkCheck {
	const value = input.trim();
	if (value === '') return { error: LINK_EMPTY };
	if (/\s/.test(value)) return { error: LINK_INVALID };
	if (TICKET_LINK.test(value)) return { href: value };
	if (ALLOWED.test(value)) {
		try {
			const url = new URL(value);
			if (url.protocol === 'mailto:' ? url.pathname === '' : url.hostname === '') {
				return { error: LINK_INVALID };
			}
		} catch {
			return { error: LINK_INVALID };
		}
		return { href: value };
	}
	if (MAIL.test(value)) return { href: `mailto:${value}` };
	if (SCHEME.test(value) && !HOST.test(value)) return { error: LINK_NOT_ALLOWED };
	if (HOST.test(value)) return checkLink(`https://${value}`);
	return { error: LINK_INVALID };
}
