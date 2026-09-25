<script lang="ts">
	import { untrack } from 'svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import Drawer from '$lib/components/overlay/Drawer.svelte';
	import { PanelShell, setPanelShell } from '$lib/overlay/panel-host.svelte';

	// Test harness for ViewWithPanel (view-with-panel.test.ts): a list with a button and, while
	// `panel` names an entry, a panel with its title: a plain landmark, or with `onclose` the side
	// panel building block. `shell` stands in for the app layout (inert header).
	let {
		panel = null,
		onclose,
		shell
	}: { panel?: string | null; onclose?: () => void; shell?: PanelShell } = $props();

	setPanelShell(untrack(() => shell) ?? new PanelShell());
</script>

<ViewWithPanel withPanel={panel !== null}>
	{#snippet list()}
		<button type="button">Zeile A</button>
	{/snippet}
	{#if panel !== null}
		{#if onclose}
			<Drawer labelledby="harness-title" {onclose}>
				<h2 id="harness-title" tabindex="-1">{panel}</h2>
			</Drawer>
		{:else}
			<aside aria-label={panel}><h2>{panel}</h2></aside>
		{/if}
	{/if}
</ViewWithPanel>
