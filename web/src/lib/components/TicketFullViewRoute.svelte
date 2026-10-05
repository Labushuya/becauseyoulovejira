<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ticketColorOf } from '$lib/domain/colors';
	import { openInstancesOf } from '$lib/domain/recurrence-rule';
	import { parentOf } from '$lib/domain/subtasks';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { SILENT_FLAGS, findFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { findAreaMoveStore } from '$lib/stores/area-move.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { findTicketOpenMode, ticketLinks } from '$lib/stores/open-mode.svelte';
	import { findPinStore } from '$lib/stores/pins.svelte';
	import { findTicketHost } from '$lib/ticket-host';
	import { FULL_VIEW_LINK, ticketPathSteps } from '$lib/ticket-links';
	import { getTicketRoute } from '$lib/ticket-route';
	import AreaMoveDialog from './AreaMoveDialog.svelte';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import ColorMark from './ColorMark.svelte';
	import DuplicateDialog from './DuplicateDialog.svelte';
	import EditableTitle from './EditableTitle.svelte';
	import FullView from './overlay/FullView.svelte';
	import RecurrenceSummary from './RecurrenceSummary.svelte';
	import TicketActions from './TicketActions.svelte';
	import TicketActivity from './TicketActivity.svelte';
	import TicketDeleteQuestion from './TicketDeleteQuestion.svelte';
	import TicketDescription from './TicketDescription.svelte';
	import TicketFields from './TicketFields.svelte';
	import TicketLeaveQuestion from './TicketLeaveQuestion.svelte';
	import TicketMeta from './TicketMeta.svelte';
	import TicketParentField from './TicketParentField.svelte';
	import TicketPinToggle from './TicketPinToggle.svelte';
	import TicketSources from './TicketSources.svelte';
	import TicketSubtasks from './TicketSubtasks.svelte';

	// Full view of a ticket (/tickets/<id>/voll; ADR-0025 section 7, decision 2 of the user): the
	// XL modal over the list with the same parts arranged in two columns. It replaces the panel
	// (plan BI-1): the panel is not mounted meanwhile. The layout of the ticket route loads the
	// ticket and holds the question about unsaved text; this page only shows it. Closing goes back
	// to the list with the same query and the focus on the row of the ticket (below 64rem to the
	// panel with the focus on "Vollansicht"); "Im Seitenpanel öffnen" in the header, at the place of
	// "Vollansicht" in the panel, shows the same ticket in the panel and remembers that choice.
	// A sub-task shows its path above the title; the path and the section "Unteraufgaben" lead to
	// the full view of the other ticket (ADR-0033 section 4). The menu "•••" of the header (plan
	// aktionsmenues) copies the link; its "In den Papierkorb …" asks inline at the top of the
	// content, because no dialog opens from the full view (ADR-0025 section 3); so does the question
	// about unsaved text when a link leaves the ticket (the layout holds the navigation). Its
	// "Duplizieren …" unfolds the question at the same place (ADR-0045 §2); the duplicate then opens
	// in the remembered way (ADR-0036 §1). Closing a question gives the focus back to the menu.
	// Over the calendar (/kalender/tickets/<id>/voll, ADR-0053 §6) and in the areas projects, inbox
	// and rules (ADR-0054) the host of the context names the addresses, and closing gives the focus
	// to the entry of the ticket there: in an area to the panel it came from, else to the view.

	const host = findTicketHost();
	const detail = getTicketDetailStore();
	const comments = getTicketActivityStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
	const rules = getRecurrenceStore();
	const sources = getTicketSourcesStore();
	const inbox = getInboxStore();
	const route = getTicketRoute();
	const openMode = findTicketOpenMode();
	const links = ticketLinks();
	const duplicates = findTicketDuplicateStore();
	const moves = findAreaMoveStore();
	const flags = findFlagStore() ?? SILENT_FLAGS;
	/** The own pins (ADR-0064): the toggle before "•••". */
	const pins = findPinStore();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	const id = $derived(page.params.id ?? '');
	const ticket = $derived(detail.state === 'ready' ? detail.ticket : null);
	/** Color of the ticket before the title of the header (ADR-0052). */
	const shown = $derived(ticket === null ? null : ticketColorOf(ticket, catalog.projectOf(ticket)));
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
						: { key: parent.key, title: parent.title, href: host.full(parent.id, page.url) }
				)
	);
	const sourceCount = $derived(
		ticket !== null && sources.ticketId === ticket.id ? sources.items.length : 0
	);
	const subtaskCount = $derived(ticket === null ? 0 : tickets.progressOf(ticket.id).total);

	/** Ticket whose inline question of "In den Papierkorb …" is shown; another starts without it. */
	let askingFor = $state<string | null>(null);
	const asking = $derived(askingFor !== null && askingFor === id);
	/** Ticket whose question of "Duplizieren …" is unfolded; another ticket starts without it. */
	let duplicatingFor = $state<string | null>(null);
	const duplicating = $derived(duplicatingFor !== null && duplicatingFor === id);
	/** The button of the menu "•••": the questions give the focus back to it. */
	let menuButton = $state<HTMLButtonElement>();

	/** Opens a ticket (the duplicate, or the original from its flag) in the remembered way. */
	function openTicket(ticketId: string) {
		void goto(links.href(ticketId, page.url));
	}

	// While the full view is shown, it asks about unsaved text instead of the layout.
	$effect(() => untrack(() => route.askInline()));

	/**
	 * "In den Haushalt verschieben …" of the menu (E7-4, ADR-0061) unfolds here like the other
	 * questions; leaving the full view drops it.
	 */
	const moving = $derived(
		moves !== null && moves.request?.inline === true && moves.request.ids[0] === id
	);
	$effect(() => () => {
		if (moves?.request?.inline === true) untrack(() => moves.close());
	});

	async function cancelDelete() {
		askingFor = null;
		await tick();
		menuButton?.focus();
	}

	/**
	 * ×, Escape and the veil: back to the view without a panel, the focus on the entry of the ticket
	 * (plan BI-1). Below 64rem, where the panel is an overlay, back to the panel as before.
	 */
	async function close() {
		if (openMode?.wide ?? true) {
			const from = page.url;
			const ticketId = id;
			await goto(host.view(from), { noScroll: true });
			await tick();
			host.entryOf(ticketId, from)?.focus();
			return;
		}
		await goto(host.panel(id, page.url), { noScroll: true });
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
		{#snippet lead()}
			{#if shown}
				<ColorMark {shown} />
			{/if}
		{/snippet}
		{#snippet actions()}
			<TicketPinToggle {ticket} {pins} variant="head" />
			<TicketActions
				{ticket}
				{flags}
				inline
				onduplicate={duplicates === null
					? null
					: () => {
							duplicatingFor = id;
							askingFor = null;
						}}
				ondelete={() => {
					askingFor = id;
					duplicatingFor = null;
				}}
				bind:trigger={menuButton}
			/>
			<!-- The mirror of "Vollansicht" in the panel: same place before the ×, same look. -->
			<a
				class="button-icon panel-view-link"
				href={host.panel(id, page.url)}
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
			{#if moving && moves !== null}
				<AreaMoveDialog store={moves} returnFocus={() => menuButton} />
			{/if}
			{#if duplicating && duplicates !== null}
				<DuplicateDialog
					{ticket}
					projects={catalog.activeProjects}
					sources={sources.ticketId === ticket.id ? sources.items : []}
					commentCount={comments.ticketId === ticket.id ? comments.comments.length : 0}
					{subtaskCount}
					parentKey={ticket.parentId ? (parent?.key ?? null) : null}
					store={duplicates}
					onopen={openTicket}
					returnFocus={() => menuButton}
					onclose={() => (duplicatingFor = null)}
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
					hrefOf={(subtaskId) => host.full(subtaskId, page.url)}
				/>
			{/if}
			<TicketSources {ticket} store={sources} candidates={inbox.newItems} />
			<TicketActivity store={comments} {catalog} pin={detail} />
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
							parentHref={parent ? host.full(parent.id, page.url) : null}
							{subtaskCount}
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
					{catalog}
					today={tickets.today}
					history={comments.history}
					openTickets={ticket.recurrenceId
						? openInstancesOf(tickets.open, ticket.recurrenceId)
						: []}
					subtasks={tickets.subtasksOf(ticket.id)}
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
