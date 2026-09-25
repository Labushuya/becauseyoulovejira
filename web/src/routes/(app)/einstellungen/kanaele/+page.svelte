<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import { pb } from '$lib/pocketbase';
	import { ConnectionsStore, connectionsData } from '$lib/stores/connections.svelte';

	// Settings of the channels (E4 plan, T-3): bookmarklet (package 7) and connections (package 10).
	// The capture address is absolute, since the bookmarklet runs on other pages. The connections
	// load when the page opens and leave with it.
	const captureUrl = $derived(new URL(resolve('/eingang/neu'), page.url.origin).href);
	const connections = new ConnectionsStore(connectionsData(pb), auth);

	$effect(() => {
		untrack(() => void connections.load());
		return () => connections.reset();
	});
</script>

<svelte:head>
	<title>Kanäle · becauseyoulovejira</title>
</svelte:head>

<ChannelsView {captureUrl} {connections} />
