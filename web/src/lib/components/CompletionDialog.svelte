<script lang="ts">
	import { openChildrenQuestion, type CompletionChoice } from '$lib/domain/subtasks';
	import type { CompletionQuestion } from '$lib/stores/ticket-list.svelte';
	import CompletionChoiceField from './CompletionChoiceField.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// The check mark of a ticket with open blocking sub-tasks asks first (ADR-0033 section 2): the
	// confirmation of ADR-0025 section 4 with the question as text and the two answers as radios
	// (ConfirmDialog.options). "Abbrechen", Escape, × and the veil keep the ticket open.
	let {
		question,
		busy = false,
		error = null,
		onconfirm,
		oncancel
	}: {
		question: CompletionQuestion;
		busy?: boolean;
		error?: string | null;
		onconfirm: (choice: CompletionChoice) => void;
		oncancel: () => void;
	} = $props();

	let choice = $state<CompletionChoice>('complete_children');
</script>

<ConfirmDialog
	open
	title={`${question.key} erledigen?`}
	confirmLabel="Erledigen"
	{busy}
	{error}
	onconfirm={() => onconfirm(choice)}
	{oncancel}
>
	<p>{openChildrenQuestion(question.count)}</p>
	{#snippet options()}
		<CompletionChoiceField
			bind:choice
			keys={question.keys}
			count={question.count}
			disabled={busy}
		/>
	{/snippet}
</ConfirmDialog>
