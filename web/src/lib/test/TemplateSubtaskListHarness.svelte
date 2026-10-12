<script lang="ts">
	import { untrack } from 'svelte';
	import TemplateSubtaskList from '$lib/components/TemplateSubtaskList.svelte';
	import type { TemplateStatus, TemplateSubtask, TicketSubtask } from '$lib/domain/series-template';

	// Test harness: the list "Unteraufgaben" of the template (plan WV-3) bound to a value the test
	// reads as JSON, inside a form like the editor at the ticket. Since UT-1 with the status per row
	// and its default.
	let {
		initial,
		ticketSubtasks = [],
		invalidRows = [],
		error = null,
		busy = false,
		statusAvailable = false,
		defaultStatus = 'open',
		hint
	}: {
		initial: TemplateSubtask[];
		ticketSubtasks?: readonly TicketSubtask[];
		invalidRows?: readonly number[];
		error?: string | null;
		busy?: boolean;
		statusAvailable?: boolean;
		defaultStatus?: TemplateStatus;
		hint?: string;
	} = $props();

	let subtasks = $state<TemplateSubtask[]>(untrack(() => initial.map((entry) => ({ ...entry }))));
</script>

<form aria-label="Vorlage" onsubmit={(event) => event.preventDefault()}>
	<TemplateSubtaskList
		bind:subtasks
		{ticketSubtasks}
		{invalidRows}
		{error}
		{busy}
		{statusAvailable}
		{defaultStatus}
		{hint}
	/>
</form>
<pre data-testid="value">{JSON.stringify(subtasks)}</pre>
