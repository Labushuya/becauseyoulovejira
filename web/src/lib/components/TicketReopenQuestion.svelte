<script lang="ts">
	import { onMount } from 'svelte';
	import { REOPEN_DETACHED_LABEL } from '$lib/domain/recurrence-rule';
	import type { DetailReopenQuestion } from '$lib/stores/ticket-detail.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// A refused reopening of an instance of a series (ADR-0023 section 3 and addendum 4), in the side
	// panel and in the full view: another ticket of the series is open, so the ticket cannot come
	// back into the series. The reason stands inline below the status, with the way out "Als
	// normales Ticket wieder öffnen (aus der Serie lösen)", like the question of the trash
	// (TrashNeedQuestion): a warning without red, no dialog (none opens from the full view). The
	// focus starts on "Abbrechen"; Escape cancels and is consumed. The owner returns the focus.
	let {
		question,
		busy = false,
		onconfirm,
		oncancel
	}: {
		question: DetailReopenQuestion;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let cancelButton = $state<HTMLButtonElement>();

	onMount(() => cancelButton?.focus());

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		if (!busy) oncancel();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="question" aria-busy={busy ? 'true' : undefined} {onkeydown}>
	<SectionMessage tone="warning" title="Nicht wieder in die Serie" headingLevel={4} live>
		<p>{question.message}</p>
		{#snippet actions()}
			<button
				class="button-secondary"
				type="button"
				aria-disabled={busy ? 'true' : undefined}
				bind:this={cancelButton}
				onclick={() => {
					if (!busy) oncancel();
				}}
			>
				Abbrechen
			</button>
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy ? 'true' : undefined}
				onclick={() => {
					if (!busy) onconfirm();
				}}
			>
				{busy ? 'Wird gespeichert …' : REOPEN_DETACHED_LABEL}
			</button>
		{/snippet}
	</SectionMessage>
</div>
