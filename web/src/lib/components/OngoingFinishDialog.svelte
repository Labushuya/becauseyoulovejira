<script lang="ts">
	import {
		ONGOING_FINISH_CONFIRM,
		ONGOING_FINISH_DAY_HINT,
		ongoingFinishText,
		ongoingFinishTitle,
		type OngoingFinishQuestion
	} from '$lib/domain/ongoing-finish';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// "Vorhaben abschließen?" (VH-1, ADR-0065 addendum VH-1): the one question before an ongoing
	// project becomes done, on every way to "Erledigt" (day plan, check mark and status cell of
	// "Aufgaben", sub-tasks, the status of the detail, the bulk actions). The confirmation of ADR-0025
	// §4 with "Abschließen" and "Abbrechen"; inside a modal (the full view) it stands inline where the
	// owner renders it. "Abbrechen", Escape, × and the veil change nothing.
	let {
		question,
		busy = false,
		error = null,
		onconfirm,
		oncancel
	}: {
		question: OngoingFinishQuestion;
		/** The confirmed action runs (day plan); the question stays locked until it ends. */
		busy?: boolean;
		error?: string | null;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<ConfirmDialog
	open
	title={ongoingFinishTitle(question)}
	confirmLabel={ONGOING_FINISH_CONFIRM}
	{busy}
	{error}
	{onconfirm}
	{oncancel}
>
	<p>{ongoingFinishText(question)}</p>
	<p>{ONGOING_FINISH_DAY_HINT}</p>
</ConfirmDialog>
