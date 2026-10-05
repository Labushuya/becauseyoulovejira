<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { setAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';

	// Test harness (E7-5, ADR-0068): a component below a fixed source of members and names, as the
	// (app) layout provides its AssigneeDirectory.
	let {
		assignees,
		component,
		props
	}: {
		assignees: AssigneeSource;
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	setAssignees(untrack(() => assignees));
	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Inner {...props} />
