<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import { fetchExtensionInfo, type ExtensionInfo } from '$lib/data/extension';
	import { setupTargetOf, type SetupTarget } from '$lib/domain/channel-setup';
	import { pb } from '$lib/pocketbase';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { ConnectionsStore, connectionsData } from '$lib/stores/connections.svelte';
	import { findFirstStepsStore } from '$lib/stores/first-steps.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { FoldersStore, foldersData } from '$lib/stores/folders.svelte';
	import { GitHubStore, githubData } from '$lib/stores/github.svelte';
	import { ImportKeywordsStore, importKeywordsData } from '$lib/stores/import-keywords.svelte';
	import { InboxKeysStore, inboxKeysData } from '$lib/stores/inbox-keys.svelte';
	import { InboxTargetsStore, inboxTargetsData } from '$lib/stores/inbox-targets.svelte';
	import { NotionStore, notionData } from '$lib/stores/notion.svelte';
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
	// Access keys of the own inbox (ADR-0038), with its keywords in importKeywords.
	const inboxKeys = new InboxKeysStore(inboxKeysData(pb), auth, flags);
	// Notion import (ADR-0041): its cards load what was imported, the dialog asks Notion.
	const notion = new NotionStore(notionData(pb), auth, flags);
	// GitHub (ADR-0050): its cards load their details, "Verbindung prüfen" asks GitHub in the server.
	const github = new GitHubStore(githubData(pb), auth, flags);
	// Folders (ADR-0051): their cards load their details and take files of before into the inbox.
	const folders = new FoldersStore(foldersData(pb), auth, flags);
	// Target projects of the cards without a connection (ADR-0049); the projects of the catalog name
	// the targets of every card.
	const inboxTargets = new InboxTargetsStore(inboxTargetsData(pb), auth, flags);
	const catalog = getCatalogStore();
	// Folder of the built extension for WhatsApp Web, for its assistant (ADR-0038 §4).
	let extension = $state<ExtensionInfo | null>(null);
	const setup = $derived(setupTargetOf(page.url.searchParams));

	function changeSetup(next: SetupTarget | null) {
		void goto(channelSetupHref(next), { replaceState: true, keepFocus: true, noScroll: true });
	}

	$effect(() => {
		untrack(() => {
			void connections.load();
			void importKeywords.load();
			void inboxKeys.load();
			void inboxTargets.load();
		});
		const controller = new AbortController();
		void fetchExtensionInfo(pb, { signal: controller.signal }).then((info) => {
			if (!controller.signal.aborted) extension = info;
		});
		return () => {
			controller.abort();
			connections.reset();
			importKeywords.reset();
			inboxKeys.reset();
			inboxTargets.reset();
			notion.reset();
			github.reset();
			folders.reset();
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

<ChannelsView
	{captureUrl}
	{connections}
	{notion}
	{github}
	{folders}
	{importKeywords}
	{inboxKeys}
	{inboxTargets}
	projects={catalog.projects}
	{extension}
	{setup}
	onsetupchange={changeSetup}
/>
