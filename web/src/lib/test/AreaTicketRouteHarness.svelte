<script lang="ts">
	import { resolve } from '$app/paths';
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
	import {
		INBOX_HOST,
		PROJECTS_HOST,
		RECURRENCES_HOST,
		setTicketHost,
		type AreaTicketHost
	} from '$lib/ticket-host';
	import type { TicketArea } from '$lib/ticket-links';
	import InboxTicketLayout from '../../routes/(app)/eingang/tickets/[id]/+layout.svelte';
	import InboxFullViewPage from '../../routes/(app)/eingang/tickets/[id]/voll/+page.svelte';
	import ProjectTicketLayout from '../../routes/(app)/projekte/tickets/[id]/+layout.svelte';
	import ProjectFullViewPage from '../../routes/(app)/projekte/tickets/[id]/voll/+page.svelte';
	import RuleTicketLayout from '../../routes/(app)/wiederholungen/tickets/[id]/+layout.svelte';
	import RuleFullViewPage from '../../routes/(app)/wiederholungen/tickets/[id]/voll/+page.svelte';

	// Test harness of /projekte/tickets/<id>, /eingang/tickets/<id>, /wiederholungen/tickets/<id> and
	// their full views (area-ticket-route.test.ts, ADR-0054): the host of the area layout in the
	// context, the layout of the ticket route with the full view as its child page, and a link of
	// the ticket in the list and in the panel part of the view, as `ViewWithPanel` names them, so the
	// focus can return there.
	let {
		area,
		full = false,
		openMode,
		entry,
		inPanel = false
	}: {
		area: TicketArea;
		full?: boolean;
		openMode?: TicketOpenModeStore;
		/** Record ID of the ticket whose link stands in the view. */
		entry: string;
		/** A link of the ticket in the panel part as well (the panel it came from). */
		inPanel?: boolean;
	} = $props();

	const HOSTS: Record<TicketArea, AreaTicketHost> = {
		projekte: PROJECTS_HOST,
		eingang: INBOX_HOST,
		wiederholungen: RECURRENCES_HOST
	};

	// svelte-ignore state_referenced_locally
	setTicketHost(HOSTS[area]);
	// svelte-ignore state_referenced_locally
	if (openMode !== undefined) setTicketOpenMode(openMode);
</script>

<div data-view-part="list">
	<a href={resolve('/')} data-ticket-link={entry}>Link in der Ansicht</a>
</div>
<div data-view-part="panel">
	{#if inPanel}
		<a href={resolve('/')} data-ticket-link={entry}>Link im Panel</a>
	{/if}
	{#if area === 'projekte'}
		<ProjectTicketLayout>
			{#if full}<ProjectFullViewPage />{/if}
		</ProjectTicketLayout>
	{:else if area === 'eingang'}
		<InboxTicketLayout>
			{#if full}<InboxFullViewPage />{/if}
		</InboxTicketLayout>
	{:else}
		<RuleTicketLayout>
			{#if full}<RuleFullViewPage />{/if}
		</RuleTicketLayout>
	{/if}
</div>
