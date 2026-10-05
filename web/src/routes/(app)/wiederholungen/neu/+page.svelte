<script lang="ts">
	import { goto } from '$app/navigation';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import Drawer from '$lib/components/overlay/Drawer.svelte';
	import RecurrencePanel from '$lib/components/RecurrencePanel.svelte';
	import type { RuleDraft } from '$lib/data/recurrence';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { RECURRENCE_UNAVAILABLE, getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { recurrenceHref, recurrencesHref } from '$lib/ticket-links';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';

	// Ticket links open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();

	// "Neue Regel" (E5 plan, T-6 and package 5): a rule without a ticket (ADR-0023 section 1). The
	// first ticket comes when the lead time is reached, right after saving if it already is. After
	// creating, the panel switches to the new rule in place (replaceState), so "back" leads to the
	// overview and not to an empty form. Before the E5 migration the panel says when rules come.
	const store = getRecurrenceStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
</script>

<svelte:head>
	<title>Neue Regel · Wiederholungen · becauseyoulovejira</title>
</svelte:head>

{#if store.state === 'unavailable'}
	<Drawer labelledby="rule-unavailable" onclose={() => goto(recurrencesHref())}>
		{#snippet context()}Wiederholungen{/snippet}
		<h2 id="rule-unavailable" tabindex="-1">Neue Regel</h2>
		<SectionMessage tone="info">{RECURRENCE_UNAVAILABLE}</SectionMessage>
	</Drawer>
{:else}
	<RecurrencePanel
		today={tickets.today}
		eachAvailable={store.eachReady}
		statusAvailable={store.statusReady}
		subtasksAvailable={store.subtasksReady}
		colorsAvailable={catalog.colorsReady}
		charmsAvailable={store.charmsReady}
		assignmentAvailable={store.assigneesReady}
		projects={catalog.activeProjects}
		tags={catalog.tags}
		projectById={(id) => catalog.projectById(id)}
		ticketHrefOf={links.path}
		oncreatetag={(name) => catalog.ensureTag(name)}
		onsave={(draft) => store.create(draft as RuleDraft)}
		onsaved={(rule) => goto(recurrenceHref(rule.id), { replaceState: true })}
		onclose={() => goto(recurrencesHref())}
	/>
{/if}

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}
</style>
