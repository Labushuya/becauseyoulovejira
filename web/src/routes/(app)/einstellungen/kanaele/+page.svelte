<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import { setupTargetOf, type SetupTarget } from '$lib/domain/channel-setup';
	import { pb } from '$lib/pocketbase';
	import { ConnectionsStore, connectionsData } from '$lib/stores/connections.svelte';
	import { findFirstStepsStore } from '$lib/stores/first-steps.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { ImportKeywordsStore, importKeywordsData } from '$lib/stores/import-keywords.svelte';
	import { channelSetupHref } from '$lib/ticket-links';

	// Settings of the channels (E4 plan, T-3): bookmarklet (package 7) and connections (package 10).
	// Since EH-1 the page lies in the settings area; the keywords of the file imports have their own
	// page "Datei-Importe", and since EH-7 the files card here shows their number per kind, so the
	// page loads them too. The capture address is absolute, since the bookmarklet runs on other
	// pages. Connections load when the page opens and leave with it. Since EH-5 the address holds
	// the setup assistant (?einrichten=<art>&verbindung=<id>): a reload opens it again, and opening,
	// creating and closing replace the history entry, so "Zurück" leaves the page.
	const captureUrl = $derived(new URL(resolve('/eingang/neu'), page.url.origin).href);
	// Results of actions go out as flags (ADR-0025 section 8).
	const flags = getFlagStore();
	const connections = new ConnectionsStore(connectionsData(pb), auth, flags);
	const importKeywords = new ImportKeywordsStore(importKeywordsData(pb), auth, flags);
	const setup = $derived(setupTargetOf(page.url.searchParams));

	function changeSetup(next: SetupTarget | null) {
		void goto(channelSetupHref(next), { replaceState: true, keepFocus: true, noScroll: true });
	}

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

	// "Erste Schritte" (plan EH-12): a connection on this page marks the step "Einen Kanal
	// einrichten".
	const firstSteps = findFirstStepsStore();
	$effect(() => {
		if (connections.connections.length > 0) untrack(() => firstSteps?.reach('channel'));
	});
</script>

<svelte:head>
	<title>Kanäle · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<ChannelsView {captureUrl} {connections} {importKeywords} {setup} onsetupchange={changeSetup} />
