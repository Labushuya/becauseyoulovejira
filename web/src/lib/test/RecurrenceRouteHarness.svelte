<script lang="ts">
	import RecurrencesLayout from '../../routes/(app)/wiederholungen/+layout.svelte';
	import RulePage from '../../routes/(app)/wiederholungen/[id]/+page.svelte';
	import NewRulePage from '../../routes/(app)/wiederholungen/neu/+page.svelte';

	// Test harness of /wiederholungen, /wiederholungen/neu and /wiederholungen/<id>
	// (recurrences-layout.test.ts, E5 package 5): the layout with the table and, as its child page,
	// the panel of a rule or "Neue Regel", as SvelteKit renders it.
	let { child = null }: { child?: 'neu' | 'rule' | null } = $props();
</script>

<RecurrencesLayout>
	{#if child === 'neu'}
		<NewRulePage />
	{:else if child === 'rule'}
		<RulePage />
	{/if}
</RecurrencesLayout>
