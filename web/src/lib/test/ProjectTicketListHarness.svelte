<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ProjectTicketList from '$lib/components/ProjectTicketList.svelte';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';

	// Test harness (project-ticket-list.test.ts, ADR-0034 addendum "Offene Tickets in Projekten"):
	// the list of the open tickets of a project below the store that remembers panel or full view,
	// as the (app) layout provides it, in an owner with the context menus of its rows.
	let {
		openMode = null,
		...list
	}: { openMode?: TicketOpenModeStore | null } & ComponentProps<typeof ProjectTicketList> =
		$props();

	// svelte-ignore state_referenced_locally
	if (openMode !== null) setTicketOpenMode(openMode);
</script>

<div {@attach rowMenus}>
	<ProjectTicketList {...list} />
</div>
