<script lang="ts">
	import { untrack } from 'svelte';
	import ChannelsView from '$lib/components/ChannelsView.svelte';
	import type { SetupTarget } from '$lib/domain/channel-setup';
	import type { ProjectRef } from '$lib/domain/ticket';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { FoldersStore } from '$lib/stores/folders.svelte';
	import type { GitHubStore } from '$lib/stores/github.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import { foldersStoreOf } from './folders-fake';
	import { githubStoreOf } from './github-fake';
	import { notionStoreOf } from './notion-fake';

	// Test harness of the page "Kanäle" with the setup assistant (channel-setup-dialog.test.ts, EH-5):
	// it keeps the assistant of the address in a state, as the page does with the URL, and reports
	// every change, so a test sees opening, creating and closing like a navigation. Without a Notion,
	// GitHub or folders store of the test the view gets an inert one (ADR-0041, ADR-0050, ADR-0051);
	// `projects` are those of the catalog (the step "Zielprojekt", ADR-0049).
	let {
		connections,
		notion = notionStoreOf(),
		github = githubStoreOf(),
		folders = foldersStoreOf(),
		projects = [],
		setup = null,
		onchange
	}: {
		connections: ConnectionsStore;
		notion?: NotionStore;
		github?: GitHubStore;
		folders?: FoldersStore;
		projects?: readonly ProjectRef[];
		setup?: SetupTarget | null;
		onchange: (next: SetupTarget | null) => void;
	} = $props();

	let current = $state<SetupTarget | null>(untrack(() => setup));
</script>

<ChannelsView
	captureUrl="http://127.0.0.1:8090/eingang/neu"
	{connections}
	{notion}
	{github}
	{folders}
	{projects}
	setup={current}
	onsetupchange={(next) => {
		onchange(next);
		current = next;
	}}
/>
