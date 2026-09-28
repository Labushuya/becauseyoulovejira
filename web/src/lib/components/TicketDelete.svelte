<script lang="ts">
	import type { SourceHandling } from '$lib/domain/sources';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import SourceHandlingChoice from './SourceHandlingChoice.svelte';
	import TicketDeleteText from './TicketDeleteText.svelte';

	// "Löschen …" of a ticket (E2 plan, package 11; ADR-0037). In the side panel the confirmation
	// asks before moving the ticket to the trash and returns the focus itself; a failure stays in
	// the dialog, afterwards the owner closes the view and a flag offers "Rückgängig". A ticket with
	// sources (ADR-0031, addendum B) names their number and asks what happens to them: back to the
	// inbox (chosen at first) or along with the ticket; sub-tasks go along (ADR-0033, addendum). The full view is a modal and opens no dialog (ADR-0025 section 3): with
	// `inline` the button only asks the owner to show TicketDeleteQuestion in its content.
	let {
		store,
		ondeleted,
		sourceCount = 0,
		subtaskCount = 0,
		inline = false,
		asking = false,
		onask,
		button = $bindable()
	}: {
		store: TicketDetailStore;
		ondeleted: () => void;
		/** Number of sources of the ticket (inbox items with `ticket = <id>`). */
		sourceCount?: number;
		/** Number of sub-tasks of the ticket. */
		subtaskCount?: number;
		/** Full view: the question stands inline in the content, not in a dialog. */
		inline?: boolean;
		/** Inline: the question is shown (aria-expanded). */
		asking?: boolean;
		/** Inline: shows the question. */
		onask?: () => void;
		/** The button, for the focus after the inline question. */
		button?: HTMLButtonElement;
	} = $props();

	let confirming = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	let handling = $state<SourceHandling>('inbox');

	const ticket = $derived(store.ticket);

	function ask() {
		if (inline) {
			onask?.();
			return;
		}
		error = null;
		handling = 'inbox';
		confirming = true;
	}

	function cancel() {
		confirming = false;
		error = null;
	}

	async function remove() {
		if (deleting) return;
		deleting = true;
		error = null;
		const result = await store.deleteTicket(
			sourceCount > 0 ? { count: sourceCount, handling } : undefined
		);
		deleting = false;
		if (result.ok) {
			confirming = false;
			ondeleted();
		} else if (result.message !== null) {
			error = result.message;
		} else {
			confirming = false;
		}
	}
</script>

<button
	class="button-subtle"
	type="button"
	aria-haspopup={inline ? undefined : 'dialog'}
	aria-expanded={inline ? asking : undefined}
	bind:this={button}
	onclick={ask}
>
	Löschen …
</button>

{#if ticket && !inline}
	<ConfirmDialog
		open={confirming}
		title={`${ticket.key} in den Papierkorb verschieben?`}
		confirmLabel="In den Papierkorb"
		busy={deleting}
		{error}
		onconfirm={remove}
		oncancel={cancel}
	>
		<TicketDeleteText {ticket} {sourceCount} {subtaskCount} />
		{#snippet options()}
			{#if sourceCount > 0}
				<SourceHandlingChoice bind:handling disabled={deleting} />
			{/if}
		{/snippet}
	</ConfirmDialog>
{/if}
