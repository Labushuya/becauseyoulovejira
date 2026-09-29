<script lang="ts">
	import { untrack } from 'svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import type { SetupTarget } from '$lib/domain/channel-setup';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import { notionStoreOf } from './notion-fake';

	// Test harness of the page "Kanäle" with the setup assistant (channel-setup-dialog.test.ts, EH-5):
	// it keeps the assistant of the address in a state, as the page does with the URL, and reports
	// every change, so a test sees opening, creating and closing like a navigation. Without a Notion
	// store of the test the view gets an inert one (ADR-0041).
	let {
		connections,
		notion = notionStoreOf(),
		setup = null,
		onchange
	}: {
		connections: ConnectionsStore;
		notion?: NotionStore;
		setup?: SetupTarget | null;
		onchange: (next: SetupTarget | null) => void;
	} = $props();

	let current = $state<SetupTarget | null>(untrack(() => setup));
</script>

<ChannelsView
	captureUrl="http://127.0.0.1:8090/eingang/neu"
	{connections}
	{notion}
	setup={current}
	onsetupchange={(next) => {
		onchange(next);
		current = next;
	}}
/>
