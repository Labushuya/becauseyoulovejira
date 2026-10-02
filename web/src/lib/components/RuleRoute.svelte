<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { openInstancesOf, type RecurrenceRule } from '$lib/domain/recurrence-rule';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { RECURRENCE_UNAVAILABLE, getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { findTicketReturn } from '$lib/ticket-return.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import RecurrencePanel from './RecurrencePanel.svelte';

	// Panel of one rule as a route (/wiederholungen/<record id>, E5 plan, T-6 and package 5; next to
	// the calendar /kalender/wiederholungen/<id>, ADR-0054 §8); a reload opens the same panel. The
	// rule comes from the store, so live changes (a ticket created by the server, a pause for an
	// archived project) show at once. While it is being deleted the panel keeps the last known rule,
	// so it does not turn into "nicht gefunden" before the navigation back (`back`). Its tickets open
	// with the host of the place (ticketLinks), and back from a ticket it replaced the focus goes to
	// the link of that ticket.
	let {
		back,
		section
	}: {
		/** × of the panel and after deleting: the overview or the calendar. */
		back: ResolvedPathname;
		/** Name of the place in the title of the page ("Wiederholungen", "Kalender"). */
		section: string;
	} = $props();

	// Ticket links open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();
	const ticketReturn = findTicketReturn();
	const store = getRecurrenceStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
	const id = $derived(page.params.id ?? '');

	/** The rule being deleted, until the navigation back. */
	let removing = $state<RecurrenceRule | null>(null);
	const rule = $derived(store.ruleById(id) ?? (removing?.id === id ? removing : null));
	// All open tickets of the rule (plan "Wiederholungen verständlich machen", recommendation 7).
	const openTickets = $derived(openInstancesOf(tickets.open, id));

	async function remove(current: RecurrenceRule) {
		removing = current;
		const result = await store.deleteRule(current.id);
		if (!result.ok) removing = null;
		return result;
	}
</script>

<svelte:head>
	<title>{rule ? `${rule.title} · ` : ''}{section} · becauseyoulovejira</title>
</svelte:head>

{#if rule}
	{@const current = rule}
	{#key id}
		<RecurrencePanel
			rule={current}
			today={tickets.today}
			eachAvailable={store.eachReady}
			statusAvailable={store.statusReady}
			subtasksAvailable={store.subtasksReady}
			colorsAvailable={catalog.colorsReady}
			projects={catalog.activeProjects}
			tags={catalog.tags}
			projectById={(projectId) => catalog.projectById(projectId)}
			{openTickets}
			ticketHrefOf={links.path}
			oncreatetag={(name) => catalog.ensureTag(name)}
			onsave={(patch) => store.update(current.id, patch)}
			ontoggle={(active) => store.setActive(current.id, active)}
			ondecide={(choice) => store.decideBacklog(current.id, choice, tickets.today)}
			ondelete={() => remove(current)}
			ondeleted={() => goto(back)}
			onclose={() => goto(back)}
			initialFocus={() => ticketReturn?.focusTarget() ?? null}
		/>
	{/key}
{:else}
	<Drawer labelledby="rule-missing" onclose={() => goto(back)}>
		{#snippet context()}Wiederholungen{/snippet}
		{#if store.state === 'unavailable'}
			<h2 id="rule-missing" tabindex="-1">Regel</h2>
			<SectionMessage tone="info">{RECURRENCE_UNAVAILABLE}</SectionMessage>
		{:else if store.state === 'error' && store.error}
			<h2 id="rule-missing" tabindex="-1">Regel</h2>
			<SectionMessage tone="error">{store.error}</SectionMessage>
		{:else if store.state !== 'ready'}
			<h2 id="rule-missing" class="visually-hidden" tabindex="-1">Regel</h2>
			<p class="loading" role="status">Regel wird geladen …</p>
		{:else}
			<h2 id="rule-missing" tabindex="-1">Regel nicht gefunden</h2>
			<p>Die Regel wurde gelöscht oder ist nicht sichtbar.</p>
		{/if}
	</Drawer>
{/if}

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	p {
		font-size: var(--font-size-body);
	}

	.loading {
		color: var(--color-text-muted);
	}
</style>
