<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import { pb } from '$lib/pocketbase';
	import { ConnectionsStore, connectionsData } from '$lib/stores/connections.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { ImportKeywordsStore, importKeywordsData } from '$lib/stores/import-keywords.svelte';

	// Settings of the channels (E4 plan, T-3): bookmarklet (package 7), connections (package 10) and
	// the keywords of the file imports (package 21). The capture address is absolute, since the
	// bookmarklet runs on other pages. Connections and keywords load when the page opens and leave
	// with it.
	const captureUrl = $derived(new URL(resolve('/eingang/neu'), page.url.origin).href);
	// Results of actions go out as flags (ADR-0025 section 8).
	const flags = getFlagStore();
	const connections = new ConnectionsStore(connectionsData(pb), auth, flags);
	const importKeywords = new ImportKeywordsStore(importKeywordsData(pb), auth, flags);

	$effect(() => {
		untrack(() => {
			void connections.load();
			void importKeywords.load();
		});
		return () => {
			connections.reset();
			importKeywords.reset();
		};
	});
</script>

<svelte:head>
	<title>Kanäle · becauseyoulovejira</title>
</svelte:head>

<ChannelsView {captureUrl} {connections} {importKeywords} />
