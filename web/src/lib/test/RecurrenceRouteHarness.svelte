<script lang="ts">
	import RecurrencesLayout from '../../routes/(app)/wiederholungen/+layout.svelte';
	import RulePage from '../../routes/(app)/wiederholungen/[id]/+page.svelte';
	import NewRulePage from '../../routes/(app)/wiederholungen/neu/+page.svelte';

	// Test harness of /wiederholungen, /wiederholungen/neu and /wiederholungen/<id>
	// (recurrences-layout.test.ts, E5 package 5): the layout with the table and, as its child page,
	// the panel of a rule or "Neue Regel", as SvelteKit renders it. For /wiederholungen/tickets/<id>
	// and its full view (ADR-0054) a stand-in for the panel of the ticket; the route of the ticket
	// has tests of its own.
	let { child = null }: { child?: 'neu' | 'rule' | 'ticket' | 'full' | null } = $props();
</script>

<RecurrencesLayout>
	{#if child === 'neu'}
		<NewRulePage />
	{:else if child === 'rule'}
		<RulePage />
	{:else if child === 'ticket'}
		<aside aria-label="Panel des Tickets">Panel</aside>
	{/if}
</RecurrencesLayout>
