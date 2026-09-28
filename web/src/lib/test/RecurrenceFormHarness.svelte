<script lang="ts">
	import { untrack } from 'svelte';
	import RecurrenceForm from '$lib/components/RecurrenceForm.svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import type { RecurrenceFormValues } from '$lib/domain/recurrence-rule';

	// Test harness of RecurrenceForm (recurrence-form.test.ts): owns the bound values like the
	// dialog and the panels do, so a click on a weekday changes the preview at once.
	let { initial, today }: { initial: RecurrenceFormValues; today: CalendarDate } = $props();

	let values = $state(untrack(() => structuredClone(initial)));

	export function current(): RecurrenceFormValues {
		return $state.snapshot(values);
	}
</script>

<RecurrenceForm bind:values {today} />
