<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ProjectsView from '$lib/components/ProjectsView.svelte';
	import TicketRowDialogs from '$lib/components/TicketRowDialogs.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { countActiveByProject, type Project } from '$lib/domain/project';
	import { aggregateCounts, type ProjectCounts } from '$lib/domain/project-tree';
	import { parentOf } from '$lib/domain/subtasks';
	import { pb } from '$lib/pocketbase';
	import { setProjectRoute } from '$lib/project-route';
	import { CatalogEditor, catalogEditorData } from '$lib/stores/catalog-editor';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { ProjectStatsStore, projectStatsData } from '$lib/stores/project-stats.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { findTicketRowActions } from '$lib/stores/ticket-row-actions.svelte';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import { PROJECTS_HOST, isTicketRoute, setTicketHost } from '$lib/ticket-host';
	import { followTicketReturn } from '$lib/ticket-return.svelte';

	// Project view (E3 plan, T-3 and package 14; ADR-0025 section 10, package UI-8; user request
	// after EH-4): the list or the tiles on the left, the project panel (/projekte/neu,
	// /projekte/<id>) on the right, like tickets and inbox. The tags live in the settings. The
	// numbers "gesamt" live only while the view is shown; leaving it ends their subscription. Editor,
	// numbers and flags reach the panels through ProjectRoute. The numbers of a parent include its
	// sub projects (ADR-0034 section 6, UP-6); the panel names its own ones as "davon direkt".
	// The open tickets in the list and in the panel (ADR-0034, addendum "Offene Tickets in
	// Projekten") come from the list store and end with the menu "•••" of the ticket rows; its
	// questions open here, once for the list and the panel. Tickets open in the projects
	// (/projekte/tickets/<id>, …/voll; ADR-0054): the host in the context makes every ticket link
	// below stay here; a ticket takes the panel column and replaces the project panel it came from,
	// whose project stays marked in the view (never the ID of a ticket). Closing it gives the focus
	// back to the link that opened it (followTicketReturn, KX-2).
	let { children } = $props();

	setTicketHost(PROJECTS_HOST);
	followTicketReturn(PROJECTS_HOST);

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();
	// The menu "•••" of the open tickets (plan aktionsmenues, AM-2); only inside the (app) layout.
	const rowActions = findTicketRowActions();
	const duplicates = findTicketDuplicateStore();
	const links = ticketLinks();
	const stats = new ProjectStatsStore(projectStatsData(pb), auth);
	const editor = new CatalogEditor(catalogEditorData(pb), auth, catalog);

	/** A ticket is shown in the panel or in the full view (ADR-0054). */
	const ticketShown = $derived(isTicketRoute(PROJECTS_HOST, page.route.id));
	/** Project of the panel, or the one the shown ticket came from. */
	const activeId = $derived(PROJECTS_HOST.activeIn(page));
	const withPanel = $derived(PROJECTS_HOST.panelShown(page.route.id));
	const creating = $derived(page.route.id === '/(app)/projekte/neu');
	const activeCounts = $derived(
		tickets.openState === 'ready' ? countActiveByProject(tickets.open) : null
	);

	/** The numbers of one project alone. */
	function ownCounts(project: Project): ProjectCounts {
		const active = activeCounts === null ? null : (activeCounts.get(project.id) ?? 0);
		return {
			active,
			total: active === null ? null : stats.total(project.id, active),
			fresh: tickets.newInProject(project.id)
		};
	}

	/** Sub projects whose numbers a top-level project includes (archived ones too). */
	function subProjectsOf(project: Project): readonly Project[] {
		return project.parentId ? [] : catalog.subProjectsOf(project.id);
	}

	/** The numbers shown for a project: with its sub projects for a parent. */
	function countsOf(project: Project): ProjectCounts {
		const subProjects = subProjectsOf(project);
		const own = ownCounts(project);
		return subProjects.length === 0 ? own : aggregateCounts(own, subProjects.map(ownCounts));
	}

	const activeOf = (project: Project) => countsOf(project).active;
	const totalOf = (project: Project) => countsOf(project).total;
	const newOf = (project: Project) => countsOf(project).fresh;

	const notify = (title: string) => flags.show({ tone: 'success', title });

	// Archiving, restoring and deleting with their flags, for the panel and the menu "•••" of a row
	// (plan aktionsmenues, AM-4).
	const route = setProjectRoute({
		editor,
		activeOf,
		totalOf,
		newOf,
		directOf: (project) => (subProjectsOf(project).length === 0 ? null : ownCounts(project)),
		notify,
		fail: (title, reason) =>
			flags.show({ tone: 'error', title, ...(reason === null ? {} : { description: reason }) }),
		async archive(project, archived) {
			const result = await editor.setProjectArchived(project, archived);
			if (result.ok) {
				notify(
					archived
						? `Projekt „${project.name}“ archiviert.`
						: `Projekt „${project.name}“ aus dem Archiv geholt.`
				);
			}
			return result;
		},
		async restoreWithParent(project, parent) {
			const first = await editor.setProjectArchived(parent, false);
			if (!first.ok) return first;
			const result = await editor.setProjectArchived(project, false);
			if (result.ok) {
				notify(`Projekt „${project.name}“ mit „${parent.name}“ aus dem Archiv geholt.`);
			}
			return result;
		},
		async remove(project) {
			const result = await editor.deleteProject(project);
			if (result.ok) notify(`Projekt „${project.name}“ gelöscht.`);
			return result;
		}
	});

	// "aktiv" counts the open tickets of the list store, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => stats.connect(liveSource(pb))));

	/** "In den Papierkorb …" of an open ticket; the panel of that ticket closes afterwards. */
	async function moveToTrash(ticketId: string, sources?: DeleteSources): Promise<DeleteResult> {
		if (rowActions === null) return { ok: false, message: null };
		const result = await rowActions.deleteTicket(sources);
		if (result.ok && ticketShown && ticketId === page.params.id) {
			await goto(PROJECTS_HOST.view(page.url));
		}
		return result;
	}
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<ProjectsView
			{catalog}
			{tickets}
			{stats}
			{activeOf}
			{totalOf}
			{newOf}
			aggregatedOf={(project) => subProjectsOf(project).length > 0}
			actions={route}
			{activeId}
			{creating}
			inboxCount={inbox.newCount}
			{rowActions}
			duplicates={duplicates !== null}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>

<!-- The questions of the menu "•••" of an open ticket, from the list or the panel. -->
{#if rowActions}
	<TicketRowDialogs
		{rowActions}
		{duplicates}
		projects={catalog.activeProjects}
		subtaskCountOf={(id) => tickets.progressOf(id).total}
		parentKeyOf={(ticket) => parentOf(ticket, (id) => tickets.find(id))?.key ?? null}
		onopen={(id) => void goto(links.href(id, page.url))}
		{moveToTrash}
	/>
{/if}
