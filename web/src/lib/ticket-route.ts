// What the route of a ticket (/tickets/<id>, its +layout.svelte) hands to the full view below it
// (/tickets/<id>/voll, ADR-0025 section 7): the one way to leave after deleting, which sets the
// flag that lets the navigation pass without asking about unsaved text, and the question about
// unsaved text itself. The layout holds a navigation up while text is unsaved; over the panel it
// asks with a confirmation, while the full view is open the full view asks inline, because no
// dialog opens from a dialog (ADR-0025 section 3).

import { createContext } from 'svelte';

export interface TicketRoute {
	/** The ticket was deleted: back to the list without the question about unsaved text. */
	deleted(): Promise<void>;
	/**
	 * The caller (the full view) asks inline while it is shown; the confirmation of the layout stays
	 * closed. Returns the function that ends this.
	 */
	askInline(): () => void;
	/** A navigation is held up and the question is to be asked inline. */
	readonly leaving: boolean;
	/** "Weiter bearbeiten": the navigation is dropped, the text stays. */
	stay(): void;
	/** "Verwerfen": the held-up navigation goes on without asking again. */
	discard(): Promise<void>;
}

const [getTicketRoute, setTicketRoute] = createContext<TicketRoute>();

export { getTicketRoute, setTicketRoute };
