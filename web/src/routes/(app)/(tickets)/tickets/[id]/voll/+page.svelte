<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import EditableTitle from '$lib/components/EditableTitle.svelte';
	import FullView from '$lib/components/overlay/FullView.svelte';
	import RecurrenceSummary from '$lib/components/RecurrenceSummary.svelte';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketDelete from '$lib/components/TicketDelete.svelte';
	import TicketDescription from '$lib/components/TicketDescription.svelte';
	import TicketFields from '$lib/components/TicketFields.svelte';
	import TicketMeta from '$lib/components/TicketMeta.svelte';
	import TicketSources from '$lib/components/TicketSources.svelte';
	import TicketSubtasks from '$lib/components/TicketSubtasks.svelte';
	import { parentOf } from '$lib/domain/subtasks';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { FULL_VIEW_LINK, fullViewHref, ticketHref } from '$lib/ticket-links';
	import { getTicketRoute } from '$lib/ticket-route';

	// Full view of a ticket (/tickets/<id>/voll; ADR-0025 section 7, decision 2 of the user): the
	// XL modal over the panel with the same parts arranged in two columns. The layout of the ticket
	// route loads the ticket and holds the question about unsaved text; this page only shows it.
	// Closing goes back to the panel with the same list query and the focus on "Vollansicht".
	// A sub-task shows its path above the title; the path and the section "Unteraufgaben" lead to
	// the full view of the other ticket (ADR-0033 section 4).

	const detail = getTicketDetailStore();
	const comments = getTicketActivityStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
	const rules = getRecurrenceStore();
	const sources = getTicketSourcesStore();
	const inbox = getInboxStore();
	const route = getTicketRoute();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	const id = $derived(page.params.id ?? '');
	const ticket = $derived(detail.state === 'ready' ? detail.ticket : null);
	const parent = $derived(
		ticket === null ? null : parentOf(ticket, (parentId) => tickets.find(parentId))
	);

	async function close() {
		await goto(ticketHref(id, page.url), { noScroll: true });
		await tick();
		document.querySelector<HTMLElement>(FULL_VIEW_LINK)?.focus();
	}
</script>

<svelte:head>
	<title>{ticket ? `${ticket.key} · Vollansicht · ` : ''}becauseyoulovejira</title>
</svelte:head>

{#if ticket}
	<FullView title={`${ticket.key} · ${ticket.title}`} onclose={close}>
		{#snippet actions()}
			<TicketDelete
				store={detail}
				ondeleted={() => void route.deleted()}
				sourceCount={sources.ticketId === ticket.id ? sources.items.length : 0}
			/>
		{/snippet}
		{#snippet main()}
			{#if parent}
				<Breadcrumbs
					label="Pfad des Tickets"
					mono
					items={[
						{ label: parent.key, href: fullViewHref(parent.id, page.url), title: parent.title },
						{ label: ticket.key }
					]}
				/>
			{/if}
			<EditableTitle store={detail} {headingId} />
			<TicketDescription store={detail} {ticket} />
			{#if !ticket.parentId}
				<TicketSubtasks
					{ticket}
					list={tickets}
					hrefOf={(subtaskId) => fullViewHref(subtaskId, page.url)}
				/>
			{/if}
			<TicketSources {ticket} store={sources} candidates={inbox.newItems} />
			<TicketActivity store={comments} {catalog} />
		{/snippet}
		{#snippet side()}
			<section class="card" aria-labelledby={`${uid}-details`}>
				<h3 id={`${uid}-details`}>Details</h3>
				<TicketFields store={detail} {catalog} {ticket} recurrenceShown />
			</section>
			<!-- RecurrenceSummary is the named section "Wiederholung"; the card only shows the title. -->
			<div class="card">
				<p class="card-title" aria-hidden="true">Wiederholung</p>
				<RecurrenceSummary
					{ticket}
					store={rules}
					today={tickets.today}
					onticket={(changed) => {
						detail.upsert(changed);
						tickets.upsert(changed);
					}}
				/>
			</div>
			{#if ticket.source !== null}
				<section class="card" aria-labelledby={`${uid}-source`}>
					<h3 id={`${uid}-source`}>Quelle</h3>
					<TicketMeta {ticket} show="source" />
				</section>
			{/if}
			<section class="card" aria-labelledby={`${uid}-dates`}>
				<h3 id={`${uid}-dates`}>Metadaten</h3>
				<TicketMeta {ticket} show="dates" />
			</section>
		{/snippet}
	</FullView>
{/if}
