<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ChannelsView from '$lib/components/ChannelsView.svelte';

	// Settings of the channels (E4 plan, T-3): bookmarklet (package 7); the connections follow
	// with package 10. The capture address is absolute, since the bookmarklet runs on other pages.
	const captureUrl = $derived(new URL(resolve('/eingang/neu'), page.url.origin).href);
</script>

<svelte:head>
	<title>Kanäle · becauseyoulovejira</title>
</svelte:head>

<ChannelsView {captureUrl} />
