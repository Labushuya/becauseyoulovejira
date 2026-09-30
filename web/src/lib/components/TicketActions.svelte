<script lang="ts">
	import { copyTicketLink } from '$lib/copy-link';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { ticketShareUrl } from '$lib/ticket-links';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';

	// The actions of a ticket in the menu "•••" (plan aktionsmenues, AM-1): "Link kopieren",
	// "Duplizieren …" (ADR-0045, only where its store is there) and, after a line, "In den Papierkorb …"
	// (ADR-0037). In the header of the side panel the two last ones open a dialog; the full view is a
	// modal and opens none (ADR-0025 addendum 16), so there (`inline`) the owner unfolds the question
	// in its content and gives the focus back to the button of the menu afterwards (`trigger`). The
	// frequent actions bound to their place stay symbol buttons next to it: "Vollansicht" or "Im
	// Seitenpanel öffnen" and ×.
	let {
		ticket,
		flags,
		inline = false,
		onduplicate = null,
		ondelete,
		trigger = $bindable()
	}: {
		ticket: { id: string; key: string };
		/** "Link kopiert" and its failure. */
		flags: FlagSink;
		/** Full view: the entries unfold a question in the content instead of a dialog. */
		inline?: boolean;
		/** "Duplizieren …"; null leaves the entry out. */
		onduplicate?: (() => void) | null;
		/** "In den Papierkorb …". */
		ondelete: () => void;
		/** The button of the menu. */
		trigger?: HTMLButtonElement;
	} = $props();

	const items = $derived.by((): MenuAction[] => [
		{
			label: 'Link kopieren',
			onselect: () =>
				void copyTicketLink(ticket.key, ticketShareUrl(ticket.id, window.location.origin), flags)
		},
		...(onduplicate === null
			? []
			: [{ label: 'Duplizieren …', dialog: !inline, onselect: onduplicate }]),
		{ label: 'In den Papierkorb …', dialog: !inline, separated: true, onselect: ondelete }
	]);
</script>

<ActionsMenu
	label={`Weitere Aktionen für ${ticket.key}`}
	buttonLabel="Weitere Aktionen"
	buttonTitle="Weitere Aktionen"
	{items}
	bind:trigger
/>
