<script lang="ts">
	import { onMount } from 'svelte';
	import type { SourceHandling } from '$lib/domain/sources';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import SourceHandlingChoice from './SourceHandlingChoice.svelte';
	import TicketDeleteText from './TicketDeleteText.svelte';

	// "Löschen …" in the full view (ADR-0033 section 4, open point of the editor plan): the full
	// view is a modal, and no dialog opens from a dialog (ADR-0025 section 3), so the question stands
	// inline at the top of its content, with the same text and choice as the confirmation of the
	// side panel. The focus starts on "Abbrechen"; Escape cancels and is consumed, so the full view
	// stays. A failure stays in the question.
	let {
		store,
		ondeleted,
		oncancel,
		sourceCount = 0,
		subtaskCount = 0
	}: {
		store: TicketDetailStore;
		ondeleted: () => void;
		/** Closes the question; the owner returns the focus to "Löschen …". */
		oncancel: () => void;
		sourceCount?: number;
		subtaskCount?: number;
	} = $props();

	let deleting = $state(false);
	let error = $state<string | null>(null);
	let handling = $state<SourceHandling>('inbox');
	let cancelButton = $state<HTMLButtonElement>();

	const ticket = $derived(store.ticket);

	onMount(() => cancelButton?.focus());

	function cancel() {
		if (!deleting) oncancel();
	}

	async function remove() {
		if (deleting) return;
		deleting = true;
		error = null;
		const result = await store.deleteTicket(
			sourceCount > 0 ? { count: sourceCount, handling } : undefined
		);
		deleting = false;
		if (result.ok) ondeleted();
		else if (result.message !== null) error = result.message;
		else oncancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}
</script>

{#if ticket}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="question" aria-busy={deleting ? 'true' : undefined} {onkeydown}>
		<SectionMessage tone="warning" title={`${ticket.key} in den Papierkorb verschieben?`}>
			<div class="text">
				<TicketDeleteText {ticket} {sourceCount} {subtaskCount} />
				{#if sourceCount > 0}
					<SourceHandlingChoice bind:handling disabled={deleting} />
				{/if}
				{#if error}
					<p class="alert-error" role="alert"><ErrorIcon /><span>{error}</span></p>
				{/if}
			</div>
			{#snippet actions()}
				<button
					class="button-secondary"
					type="button"
					aria-disabled={deleting ? 'true' : undefined}
					bind:this={cancelButton}
					onclick={cancel}
				>
					Abbrechen
				</button>
				<button
					class="button-primary"
					type="button"
					aria-disabled={deleting ? 'true' : undefined}
					onclick={remove}
				>
					{deleting ? 'Wird verschoben …' : 'In den Papierkorb'}
				</button>
			{/snippet}
		</SectionMessage>
	</div>
{/if}

<style>
	.text {
		display: grid;
		gap: 0.5rem;
	}
</style>
