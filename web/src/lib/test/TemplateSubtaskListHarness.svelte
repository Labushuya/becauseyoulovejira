<script lang="ts">
	import { untrack } from 'svelte';
	import TemplateSubtaskList from '$lib/components/TemplateSubtaskList.svelte';
	import type { TemplateSubtask, TicketSubtask } from '$lib/domain/series-template';

	// Test harness: the list "Unteraufgaben" of the template (plan WV-3) bound to a value the test
	// reads as JSON, inside a form like the editor at the ticket.
	let {
		initial,
		ticketSubtasks = [],
		invalidRows = [],
		error = null,
		busy = false
	}: {
		initial: TemplateSubtask[];
		ticketSubtasks?: readonly TicketSubtask[];
		invalidRows?: readonly number[];
		error?: string | null;
		busy?: boolean;
	} = $props();

	let subtasks = $state<TemplateSubtask[]>(untrack(() => initial.map((entry) => ({ ...entry }))));
</script>

<form aria-label="Vorlage" onsubmit={(event) => event.preventDefault()}>
	<TemplateSubtaskList bind:subtasks {ticketSubtasks} {invalidRows} {error} {busy} />
</form>
<pre data-testid="value">{JSON.stringify(subtasks)}</pre>
