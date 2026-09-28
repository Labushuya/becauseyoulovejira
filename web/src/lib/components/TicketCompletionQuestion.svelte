<script lang="ts">
	import { onMount } from 'svelte';
	import { openChildrenQuestion, type CompletionChoice } from '$lib/domain/subtasks';
	import type { DetailCompletionQuestion } from '$lib/stores/ticket-detail.svelte';
	import CompletionChoiceField from './CompletionChoiceField.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Status "Erledigt" of a ticket with open blocking sub-tasks (ADR-0033 section 2), in the side
	// panel and in the full view: the question stands inline below the status, because no dialog
	// opens from the full view (ADR-0025 section 3) and both places should work the same. The focus
	// starts on "Abbrechen"; Escape cancels and is consumed. The owner returns the focus afterwards.
	let {
		question,
		busy = false,
		onconfirm,
		oncancel
	}: {
		question: DetailCompletionQuestion;
		busy?: boolean;
		onconfirm: (choice: CompletionChoice) => void;
		oncancel: () => void;
	} = $props();

	let choice = $state<CompletionChoice>('complete_children');
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
	<SectionMessage tone="warning" title={openChildrenQuestion(question.count)} headingLevel={4}>
		<CompletionChoiceField
			bind:choice
			keys={question.keys}
			count={question.count}
			disabled={busy}
		/>
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
					if (!busy) onconfirm(choice);
				}}
			>
				{busy ? 'Wird gespeichert …' : 'Erledigen'}
			</button>
		{/snippet}
	</SectionMessage>
</div>
