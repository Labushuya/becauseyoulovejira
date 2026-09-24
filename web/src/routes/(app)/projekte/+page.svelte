<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import ProjectsView from '$lib/components/ProjectsView.svelte';
	import { pb } from '$lib/pocketbase';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { CatalogEditor, catalogEditorData } from '$lib/stores/catalog-editor';
	import { ProjectStatsStore, projectStatsData } from '$lib/stores/project-stats.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

	// Project view (E3 plan, T-3 and package 14): no KPI tiles, no filter bar, no table. The
	// numbers "gesamt" live only while the view is shown; leaving it ends their subscription.
	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const stats = new ProjectStatsStore(projectStatsData(pb), auth);
	const editor = new CatalogEditor(catalogEditorData(pb), auth, catalog);

	// "aktiv" counts the open tickets of the list store, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => stats.connect(liveSource(pb))));
</script>

<svelte:head>
	<title>Projekte · becauseyoulovejira</title>
</svelte:head>

<ProjectsView {catalog} {tickets} {stats} {editor} />
