<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import type { Project } from '$lib/domain/project';
	import { PROJECT_TICKETS_FAILED, openTicketsOf } from '$lib/domain/project-tickets';
	import { PATH_SEPARATOR } from '$lib/domain/project-tree';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { rowMenus } from '$lib/overlay/context-menu';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import ProjectTicketList from './ProjectTicketList.svelte';

	// The section "Offene Tickets" of the project panel (ADR-0034, addendum "Offene Tickets in
	// Projekten"): the compact list of the project with the same limit as in the project list. A
	// parent lists its own tickets first, then every sub project with its own ones below a heading,
	// indented like the tree of the list (ADR-0034 §6); an archived sub project only while it still
	// has open tickets. The tickets come from the list store, live; a right click or Shift+F10 on an
	// entry opens its menu "•••" (rowMenus).
	let {
		project,
		subProjects = [],
		tickets,
		today,
		loading = false,
		failed = false,
		rowActions = null,
		duplicates = false,
		returnFocus
	}: {
		project: Project;
		/** Sub projects of the project (archived ones included), in the order of the catalog. */
		subProjects?: readonly Project[];
		/** Every open ticket of the list store. */
		tickets: readonly TicketSummary[];
		today: CalendarDate;
		loading?: boolean;
		/** Loading the open tickets failed. */
		failed?: boolean;
		rowActions?: TicketRowActionsStore | null;
		duplicates?: boolean;
		/** Where the focus goes when the focused entry leaves an emptied list. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const own = $derived(openTicketsOf(tickets, project.id));
	/** Sub projects with their tickets: the active ones, archived ones only with open tickets. */
	const groups = $derived(
		subProjects
			.map((sub) => ({ project: sub, tickets: openTicketsOf(tickets, sub.id) }))
			.filter((group) => !group.project.archived || group.tickets.length > 0)
	);
	const error = $derived(failed ? PROJECT_TICKETS_FAILED : null);
</script>

<div class="open-tickets" {@attach rowMenus}>
	{#if groups.length === 0}
		<ProjectTicketList
			{project}
			tickets={own}
			{today}
			{loading}
			{error}
			{rowActions}
			{duplicates}
			headingLevel={4}
			{returnFocus}
		/>
	{:else}
		<section class="group" aria-labelledby={`${uid}-own`}>
			<h4 id={`${uid}-own`}>{project.name}</h4>
			<ProjectTicketList
				{project}
				tickets={own}
				{today}
				ownOnly
				{loading}
				{error}
				{rowActions}
				{duplicates}
				headingLevel={4}
				{returnFocus}
			/>
		</section>
		{#each groups as group (group.project.id)}
			<section class="group sub" aria-labelledby={`${uid}-${group.project.id}`}>
				<h4 id={`${uid}-${group.project.id}`}>
					{project.name}{PATH_SEPARATOR}{group.project.name}
					<span class="code">{group.project.code}</span>
					{#if group.project.archived}<span class="archived">(archiviert)</span>{/if}
				</h4>
				<ProjectTicketList
					project={group.project}
					tickets={group.tickets}
					{today}
					{loading}
					{error}
					{rowActions}
					{duplicates}
					headingLevel={4}
					{returnFocus}
				/>
			</section>
		{/each}
	{/if}
</div>

<style>
	.open-tickets {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.group {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	/* A sub project below its parent, indented like in the list (ADR-0034 §6). */
	.sub {
		padding-left: 1.75rem;
	}

	h4 {
		font-size: var(--font-size-control);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.code {
		font-family: var(--font-mono);
		font-weight: 400;
		color: var(--color-brand-text);
	}

	.archived {
		font-weight: 400;
		color: var(--color-text-muted);
	}
</style>
