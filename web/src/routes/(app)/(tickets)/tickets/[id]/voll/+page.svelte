<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import EditableTitle from '$lib/components/EditableTitle.svelte';
	import FullView from '$lib/components/overlay/FullView.svelte';
	import RecurrenceSummary from '$lib/components/RecurrenceSummary.svelte';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketDelete from '$lib/components/TicketDelete.svelte';
	import TicketDeleteQuestion from '$lib/components/TicketDeleteQuestion.svelte';
	import TicketDescription from '$lib/components/TicketDescription.svelte';
	import TicketFields from '$lib/components/TicketFields.svelte';
	import TicketLeaveQuestion from '$lib/components/TicketLeaveQuestion.svelte';
	import TicketMeta from '$lib/components/TicketMeta.svelte';
	import TicketParentField from '$lib/components/TicketParentField.svelte';
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
	import { findTicketOpenMode } from '$lib/stores/open-mode.svelte';
	import {
		FULL_VIEW_LINK,
		fullViewHref,
		listHref,
		ticketHref,
		ticketPathSteps
	} from '$lib/ticket-links';
	import { getTicketRoute } from '$lib/ticket-route';

	// Full view of a ticket (/tickets/<id>/voll; ADR-0025 section 7, decision 2 of the user): the
	// XL modal over the list with the same parts arranged in two columns. It replaces the panel
	// (plan BI-1): the panel is not mounted meanwhile. The layout of the ticket route loads the
	// ticket and holds the question about unsaved text; this page only shows it. Closing goes back
	// to the list with the same query and the focus on the row of the ticket (below 64rem to the
	// panel with the focus on "Vollansicht"); "Im Seitenpanel öffnen" in the header, at the place of
	// "Vollansicht" in the panel, shows the same ticket in the panel and remembers that choice.
	// A sub-task shows its path above the title; the path and the section "Unteraufgaben" lead to
	// the full view of the other ticket (ADR-0033 section 4). "Löschen …" asks inline at the top of
	// the content, because no dialog opens from the full view (ADR-0025 section 3); so does the
	// question about unsaved text when a link leaves the ticket (the layout holds the navigation).

	const detail = getTicketDetailStore();
	const comments = getTicketActivityStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
	const rules = getRecurrenceStore();
	const sources = getTicketSourcesStore();
	const inbox = getInboxStore();
	const route = getTicketRoute();
	const openMode = findTicketOpenMode();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	const id = $derived(page.params.id ?? '');
	const ticket = $derived(detail.state === 'ready' ? detail.ticket : null);
	const parent = $derived(
		ticket === null ? null : parentOf(ticket, (parentId) => tickets.find(parentId))
	);
	/** "Haus › Garten › HAUS-12 › GART-3" (ADR-0033, ADR-0034); links lead to full views. */
	const path = $derived(
		ticket === null
			? []
			: ticketPathSteps(
					ticket.key,
					catalog.projectOf(ticket),
					parent === null
						? null
						: { key: parent.key, title: parent.title, href: fullViewHref(parent.id, page.url) }
				)
	);
	const sourceCount = $derived(
		ticket !== null && sources.ticketId === ticket.id ? sources.items.length : 0
	);
	const subtaskCount = $derived(ticket === null ? 0 : tickets.progressOf(ticket.id).total);

	/** Ticket whose inline question of "Löschen …" is shown; another ticket starts without it. */
	let askingFor = $state<string | null>(null);
	const asking = $derived(askingFor !== null && askingFor === id);
	let deleteButton = $state<HTMLButtonElement>();

	// While the full view is shown, it asks about unsaved text instead of the layout.
	$effect(() => untrack(() => route.askInline()));

	async function cancelDelete() {
		askingFor = null;
		await tick();
		deleteButton?.focus();
	}

	/**
	 * ×, Escape and the veil: back to the list without a panel, the focus on the row of the ticket
	 * (plan BI-1). Below 64rem, where the panel is an overlay, back to the panel as before.
	 */
	async function close() {
		if (openMode?.wide ?? true) {
			await goto(listHref(page.url), { noScroll: true });
			await tick();
			const row = [...document.querySelectorAll<HTMLElement>('tr[data-ticket-id]')].find(
				(element) => element.dataset.ticketId === id
			);
			row?.querySelector<HTMLElement>('a.title-link')?.focus();
			return;
		}
		await goto(ticketHref(id, page.url), { noScroll: true });
		await tick();
		document.querySelector<HTMLElement>(FULL_VIEW_LINK)?.focus();
	}

	/** "Im Seitenpanel öffnen": the same ticket in the panel, remembered as the way to open. */
	function toPanel(event: MouseEvent) {
		if (event.ctrlKey || event.metaKey || event.shiftKey) return;
		openMode?.choose('panel');
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
				inline
				{asking}
				onask={() => (askingFor = id)}
				bind:button={deleteButton}
			/>
			<!-- The mirror of "Vollansicht" in the panel: same place before the ×, same look. -->
			<a
				class="button-icon panel-view-link"
				href={ticketHref(id, page.url)}
				aria-label="Im Seitenpanel öffnen"
				title="Im Seitenpanel öffnen"
				data-panel-view-link
				onclick={toPanel}
			>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path d="M13.5 6.5h-4v-4M9.5 6.5L14 2M2.5 9.5h4v4M6.5 9.5L2 14" />
				</svg>
			</a>
		{/snippet}
		{#snippet main()}
			{#if route.leaving}
				<TicketLeaveQuestion onstay={() => route.stay()} ondiscard={() => void route.discard()} />
			{/if}
			{#if asking}
				<TicketDeleteQuestion
					store={detail}
					ondeleted={() => void route.deleted()}
					oncancel={() => void cancelDelete()}
					{sourceCount}
					{subtaskCount}
				/>
			{/if}
			{#if path.length > 0}
				<Breadcrumbs label="Pfad des Tickets" items={path} />
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
				<TicketFields store={detail} {catalog} {ticket} recurrenceShown>
					{#snippet parentRow()}
						<TicketParentField
							store={detail}
							{ticket}
							{parent}
							parentHref={parent ? fullViewHref(parent.id, page.url) : null}
							{subtaskCount}
							search={(text, options) => sources.search(text, options)}
						/>
					{/snippet}
				</TicketFields>
			</section>
			<!-- RecurrenceSummary is the named section "Wiederholung"; the card only shows the title. -->
			<div class="card">
				<p class="card-title" aria-hidden="true">Wiederholung</p>
				<RecurrenceSummary
					{ticket}
					store={rules}
					today={tickets.today}
					history={comments.history}
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

<style>
	/* Drawn like the icons of the header of the panel and the modal. */
	.panel-view-link svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
