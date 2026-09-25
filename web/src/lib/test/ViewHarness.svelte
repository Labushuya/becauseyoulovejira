<script lang="ts">
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';

	// Test harness for ViewWithPanel (view-with-panel.test.ts): a list with a button and, while
	// `panel` names an entry, a panel with its title.
	let { panel = null }: { panel?: string | null } = $props();
</script>

<ViewWithPanel withPanel={panel !== null}>
	{#snippet list()}
		<button type="button">Zeile A</button>
	{/snippet}
	{#if panel !== null}
		<aside aria-label={panel}><h2>{panel}</h2></aside>
	{/if}
</ViewWithPanel>
