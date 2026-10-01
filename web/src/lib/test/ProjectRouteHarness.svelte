<script lang="ts">
	import ProjectsLayout from '../../routes/(app)/projekte/+layout.svelte';
	import ProjectPage from '../../routes/(app)/projekte/[id]/+page.svelte';
	import NewProjectPage from '../../routes/(app)/projekte/neu/+page.svelte';
	import {
		setTicketDuplicateStore,
		type TicketDuplicateStore
	} from '$lib/stores/ticket-duplicate.svelte';
	import {
		setTicketRowActions,
		type TicketRowActionsStore
	} from '$lib/stores/ticket-row-actions.svelte';

	// Test harness of /projekte, /projekte/neu and /projekte/<id> (projects-layout.test.ts, UI-8): the
	// layout with the tiles and, as its child page, the panel of a project or "Neues Projekt", as
	// SvelteKit renders it. With `rowActions` (and `duplicates`) the open tickets of the projects
	// get the menu "•••" of the ticket rows, as below the (app) layout (ADR-0034, addendum "Offene
	// Tickets in Projekten").
	let {
		child = null,
		rowActions = null,
		duplicates = null
	}: {
		child?: 'neu' | 'project' | null;
		rowActions?: TicketRowActionsStore | null;
		duplicates?: TicketDuplicateStore | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	if (rowActions !== null) setTicketRowActions(rowActions);
	// svelte-ignore state_referenced_locally
	if (duplicates !== null) setTicketDuplicateStore(duplicates);
</script>

<ProjectsLayout>
	{#if child === 'neu'}
		<NewProjectPage />
	{:else if child === 'project'}
		<ProjectPage />
	{/if}
</ProjectsLayout>
