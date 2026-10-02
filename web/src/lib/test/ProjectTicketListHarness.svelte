<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ProjectTicketList from '$lib/components/ProjectTicketList.svelte';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
	import { setTicketHost, type TicketHost } from '$lib/ticket-host';

	// Test harness (project-ticket-list.test.ts, ADR-0034 addendum "Offene Tickets in Projekten"):
	// the list of the open tickets of a project below the store that remembers panel or full view,
	// as the (app) layout provides it, and below the host of the projects layout (ADR-0054), in an
	// owner with the context menus of its rows.
	let {
		openMode = null,
		host = null,
		...list
	}: {
		openMode?: TicketOpenModeStore | null;
		host?: TicketHost | null;
	} & ComponentProps<typeof ProjectTicketList> = $props();

	// svelte-ignore state_referenced_locally
	if (openMode !== null) setTicketOpenMode(openMode);
	// svelte-ignore state_referenced_locally
	if (host !== null) setTicketHost(host);
</script>

<div {@attach rowMenus}>
	<ProjectTicketList {...list} />
</div>
