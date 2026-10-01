<script lang="ts">
	import type { SourceHandling } from '$lib/domain/sources';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import SourceHandlingChoice from './SourceHandlingChoice.svelte';
	import TicketDeleteText from './TicketDeleteText.svelte';

	// "In den Papierkorb …" of a ticket outside the full view (E2 plan, package 11; ADR-0037): the
	// confirmation asks before moving the ticket to the trash; the owner (the side panel, since AM-2
	// also the table for a row) shows it after the choice in the menu "•••" (plan aktionsmenues)
	// and drops it on `onclose`, and the modal returns the focus to the button of the menu. A failure
	// stays in the dialog; afterwards the panel closes and a flag offers "Rückgängig". A ticket with sources (ADR-0031, addendum B) names
	// their number and asks what happens to them: back to the inbox (chosen at first) or along with
	// the ticket; sub-tasks go along (ADR-0033, addendum). The full view asks inline instead
	// (TicketDeleteQuestion), because no dialog opens from it (ADR-0025 section 3).
	let {
		ticket,
		remove,
		ondeleted,
		onclose,
		sourceCount = 0,
		subtaskCount = 0
	}: {
		ticket: Pick<TicketSummary, 'key' | 'recurring' | 'status'>;
		/** Moves the ticket to the trash, the sources as chosen. */
		remove: (sources?: DeleteSources) => Promise<DeleteResult>;
		/** The ticket is in the trash: the panel closes (a row of the table needs nothing). */
		ondeleted?: () => void;
		/** Cancel, or the ticket is gone: the owner drops the dialog. */
		onclose: () => void;
		/** Number of sources of the ticket (inbox items with `ticket = <id>`). */
		sourceCount?: number;
		/** Number of sub-tasks of the ticket. */
		subtaskCount?: number;
	} = $props();

	let deleting = $state(false);
	let error = $state<string | null>(null);
	let handling = $state<SourceHandling>('inbox');

	async function moveToTrash() {
		if (deleting) return;
		deleting = true;
		error = null;
		const result = await remove(sourceCount > 0 ? { count: sourceCount, handling } : undefined);
		deleting = false;
		if (result.ok) {
			onclose();
			ondeleted?.();
		} else if (result.message !== null) {
			error = result.message;
		} else {
			onclose();
		}
	}
</script>

<ConfirmDialog
	open
	title={`${ticket.key} in den Papierkorb verschieben?`}
	confirmLabel="In den Papierkorb"
	busy={deleting}
	{error}
	onconfirm={moveToTrash}
	oncancel={onclose}
>
	<TicketDeleteText {ticket} {sourceCount} {subtaskCount} />
	{#snippet options()}
		{#if sourceCount > 0}
			<SourceHandlingChoice bind:handling disabled={deleting} />
		{/if}
	{/snippet}
</ConfirmDialog>
