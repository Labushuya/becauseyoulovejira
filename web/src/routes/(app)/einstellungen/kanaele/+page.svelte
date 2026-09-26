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
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { channelSetupHref } from '$lib/ticket-links';

	// Settings of the channels (E4 plan, T-3): bookmarklet (package 7) and connections (package 10).
	// Since EH-1 the page lies in the settings area; the keywords of the file imports have their own
	// page "Datei-Importe". The capture address is absolute, since the bookmarklet runs on other
	// pages. Connections load when the page opens and leave with it. Since EH-5 the address holds
	// the setup assistant (?einrichten=<art>&verbindung=<id>): a reload opens it again, and opening,
	// creating and closing replace the history entry, so "Zurück" leaves the page.
	const captureUrl = $derived(new URL(resolve('/eingang/neu'), page.url.origin).href);
	// Results of actions go out as flags (ADR-0025 section 8).
	const flags = getFlagStore();
	const connections = new ConnectionsStore(connectionsData(pb), auth, flags);
	const setup = $derived(setupTargetOf(page.url.searchParams));

	function changeSetup(next: SetupTarget | null) {
		void goto(channelSetupHref(next), { replaceState: true, keepFocus: true, noScroll: true });
	}

	$effect(() => {
		untrack(() => void connections.load());
		return () => connections.reset();
	});
</script>

<svelte:head>
	<title>Kanäle · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<ChannelsView {captureUrl} {connections} {setup} onsetupchange={changeSetup} />
