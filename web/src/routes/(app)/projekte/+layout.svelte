<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ProjectsView from '$lib/components/ProjectsView.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { countActiveByProject, type Project } from '$lib/domain/project';
	import { pb } from '$lib/pocketbase';
	import { setProjectRoute } from '$lib/project-route';
	import { CatalogEditor, catalogEditorData } from '$lib/stores/catalog-editor';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { ProjectStatsStore, projectStatsData } from '$lib/stores/project-stats.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

	// Project view (E3 plan, T-3 and package 14; ADR-0025 section 10, package UI-8; user request
	// after EH-4): the list or the tiles on the left, the project panel (/projekte/neu,
	// /projekte/<id>) on the right, like tickets and inbox. The tags live in the settings. The numbers "gesamt" live only while the view is shown; leaving it
	// ends their subscription. Editor, numbers and flags reach the panels through ProjectRoute.
	let { children } = $props();

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();
	const stats = new ProjectStatsStore(projectStatsData(pb), auth);
	const editor = new CatalogEditor(catalogEditorData(pb), auth, catalog);

	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/projekte');
	const creating = $derived(page.route.id === '/(app)/projekte/neu');
	const activeCounts = $derived(
		tickets.openState === 'ready' ? countActiveByProject(tickets.open) : null
	);

	function activeOf(project: Project): number | null {
		return activeCounts === null ? null : (activeCounts.get(project.id) ?? 0);
	}

	function totalOf(project: Project): number | null {
		const active = activeOf(project);
		return active === null ? null : stats.total(project.id, active);
	}

	setProjectRoute({
		editor,
		activeOf,
		totalOf,
		newOf: (project) => tickets.newInProject(project.id),
		notify: (title) => flags.show({ tone: 'success', title })
	});

	// "aktiv" counts the open tickets of the list store, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => stats.connect(liveSource(pb))));
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<ProjectsView
			{catalog}
			{tickets}
			{stats}
			{activeOf}
			{totalOf}
			{activeId}
			{creating}
			inboxCount={inbox.newCount}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
