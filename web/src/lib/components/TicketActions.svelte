<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { areaMover } from '$lib/area-move-entry';
	import { copyTicketLink } from '$lib/copy-link';
	import { findDayPlanEntryStore } from '$lib/stores/day-plan.svelte';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { ticketShareUrl } from '$lib/ticket-links';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';

	// The actions of a ticket in the menu "•••" (plan aktionsmenues): "Link kopieren", "Duplizieren …"
	// (ADR-0045, only where its store is there) and, after a line, "In den Papierkorb …" (ADR-0037).
	// AM-1, the header of the side panel and the full view: in the panel the two last ones open a
	// dialog; the full view is a modal and opens none (ADR-0025 addendum 16), so there (`inline`) the
	// owner unfolds the question in its content and gives the focus back to the button of the menu
	// afterwards (`trigger`). The frequent actions bound to their place stay symbol buttons next to
	// it: "Vollansicht" or "Im Seitenpanel öffnen" and ×. AM-2, a row of the table: `open` puts
	// "Im Seitenpanel öffnen" and "In Vollansicht öffnen" first, links that open the ticket that way
	// whatever way is remembered, and remember nothing (ADR-0036 §1: only the buttons in the ticket
	// do); the button names its ticket, because every row has one. In the grid of the calendar an open
	// ticket adds "Fälligkeit verschieben …" (`onmovedue`, ADR-0053 §12), which then asks for the day.
	// Since E7-4 (ADR-0061) "In den Haushalt verschieben …" or "Ins Private verschieben …" follows
	// "Duplizieren …", only for an account in a household with the right (lib/area-move-entry.ts); in
	// the full view its dialog unfolds inline like the others. Since TP-1 (ADR-0065) "Zum Tagesplan"
	// puts a ticket that is not done into the plan of today of its own area (only inside the (app)
	// layout, which has the store).
	let {
		ticket,
		flags,
		inline = false,
		open = null,
		onmovedue = null,
		onduplicate = null,
		ondelete,
		buttonLabel = 'Weitere Aktionen',
		buttonClass,
		buttonTabindex,
		trigger = $bindable()
	}: {
		/**
		 * `owner`: who created it; moving it into the private area is offered to the creator. A done
		 * ticket (`status`) is not offered for the day plan.
		 */
		ticket: { id: string; key: string; owner?: string; status?: string };
		/** "Link kopiert" and its failure. */
		flags: FlagSink;
		/** Full view: the entries unfold a question in the content instead of a dialog. */
		inline?: boolean;
		/** A row of the table: the addresses of the panel and the full view of the ticket. */
		open?: { panel: ResolvedPathname; full: ResolvedPathname } | null;
		/** "Fälligkeit verschieben …" (calendar); null leaves the entry out. */
		onmovedue?: (() => void) | null;
		/** "Duplizieren …"; null leaves the entry out. */
		onduplicate?: (() => void) | null;
		/** "In den Papierkorb …". */
		ondelete: () => void;
		/** Name of the button; a row names its ticket ("Weitere Aktionen für HAUS-12"). */
		buttonLabel?: string;
		/** Classes of the button, `.button-icon` by default. */
		buttonClass?: string;
		/** -1: the button is no stop of Tab (an entry of the calendar grid, ADR-0053 §8). */
		buttonTabindex?: -1;
		/** The button of the menu. */
		trigger?: HTMLButtonElement;
	} = $props();

	const mover = areaMover();
	const move = $derived(
		mover.entry({ kind: 'ticket', records: [ticket], label: ticket.key }, { inline })
	);
	const dayPlan = findDayPlanEntryStore();
	const planEntry = $derived(
		dayPlan === null || ticket.status === 'done'
			? null
			: {
					label: 'Zum Tagesplan',
					busy: dayPlan.isPending(ticket.id),
					onselect: () => void dayPlan.add(ticket)
				}
	);

	const items = $derived.by((): MenuAction[] => [
		...(open === null
			? []
			: [
					{ label: 'Im Seitenpanel öffnen', href: open.panel },
					{ label: 'In Vollansicht öffnen', href: open.full }
				]),
		...(onmovedue === null
			? []
			: [{ label: 'Fälligkeit verschieben …', separated: open !== null, onselect: onmovedue }]),
		...(planEntry === null
			? []
			: [{ ...planEntry, separated: open !== null && onmovedue === null }]),
		{
			label: 'Link kopieren',
			separated: open !== null && onmovedue === null && planEntry === null,
			onselect: () =>
				void copyTicketLink(ticket.key, ticketShareUrl(ticket.id, window.location.origin), flags)
		},
		...(onduplicate === null
			? []
			: [{ label: 'Duplizieren …', dialog: !inline, onselect: onduplicate }]),
		...(move === null ? [] : [{ label: move.label, dialog: !inline, onselect: move.run }]),
		{ label: 'In den Papierkorb …', dialog: !inline, separated: true, onselect: ondelete }
	]);
</script>

<ActionsMenu
	label={`Weitere Aktionen für ${ticket.key}`}
	{buttonLabel}
	buttonTitle="Weitere Aktionen"
	{buttonClass}
	{buttonTabindex}
	{items}
	bind:trigger
/>
