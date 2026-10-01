<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import DuplicateDialog from '$lib/components/DuplicateDialog.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import RecurrenceSummary from '$lib/components/RecurrenceSummary.svelte';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import TicketParentField from '$lib/components/TicketParentField.svelte';
	import TicketSources from '$lib/components/TicketSources.svelte';
	import TicketSubtasks from '$lib/components/TicketSubtasks.svelte';
	import { openInstancesOf } from '$lib/domain/recurrence-rule';
	import { parentOf } from '$lib/domain/subtasks';
	import type { Ticket } from '$lib/domain/ticket';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { SILENT_FLAGS, findFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { findTicketOpenMode, ticketLinks } from '$lib/stores/open-mode.svelte';
	import { findRecentTickets } from '$lib/stores/ticket-picker.svelte';
	import { appHref, fullViewHref, listHref } from '$lib/ticket-links';
	import { setTicketRoute } from '$lib/ticket-route';

	// Detail panel of /tickets/<record id> (E2 plan, T-4) and the full view /tickets/<id>/voll below
	// it (ADR-0025 section 7): this layout loads the ticket and its comments once for both, holds the
	// question about unsaved text and renders the panel. The full view replaces the panel (plan
	// BI-1): while it is shown, the panel is not mounted, so the two never stand at the same time,
	// also not after back or forward. A reload opens the same panel or full view. Links to other
	// tickets follow the remembered way to open them (panel or full view).
	let { children } = $props();

	const links = ticketLinks();
	const detail = getTicketDetailStore();
	const comments = getTicketActivityStore();
	const catalog = getCatalogStore();
	const tickets = getTicketListStore();
	const rules = getRecurrenceStore();
	const sourceStore = getTicketSourcesStore();
	const inbox = getInboxStore();
	const id = $derived(page.params.id ?? '');
	const back = $derived(listHref(page.url));
	const full = $derived(fullViewHref(id, page.url));
	const fullView = $derived(page.route.id === '/(app)/(tickets)/tickets/[id]/voll');
	const modeStore = findTicketOpenMode();
	const recentTickets = findRecentTickets();
	const duplicates = findTicketDuplicateStore();
	// "Link kopiert" of the menu "•••" (plan aktionsmenues).
	const flags = findFlagStore() ?? SILENT_FLAGS;
	// The parent of a sub-task for its path (ADR-0033), as the list knows it.
	const parent = $derived(
		detail.state === 'ready' && detail.ticket
			? parentOf(detail.ticket, (parentId) => tickets.find(parentId))
			: null
	);

	/** Opens a ticket (the duplicate, or the original from its flag) in the remembered way (ADR-0036). */
	function openTicket(ticketId: string) {
		void goto(links.href(ticketId, page.url));
	}

	/** Panel and full view of the same ticket: moving between them keeps drafts and asks nothing. */
	const TICKET_ROUTES = ['/(app)/(tickets)/tickets/[id]', '/(app)/(tickets)/tickets/[id]/voll'];

	$effect(() => {
		const current = id;
		untrack(() => {
			// Another ticket in the same panel: its drafts are new, so leaving asks again. The draft
			// of a template belongs to the ticket it was opened at (plan WV).
			discarding = false;
			rules.cancelTemplate();
			detail.open(current);
			comments.open(current);
		});
	});

	// Opening a ticket in the panel marks it as read (ADR-0015 section 3), in every tab, and puts it
	// first among the recently viewed ones of the ticket picker (ADR-0042).
	$effect(() => {
		const ticket = detail.state === 'ready' ? detail.ticket : null;
		if (ticket === null) return;
		untrack(() => {
			void tickets.markRead(ticket);
			recentTickets?.remember(ticket.id);
		});
	});

	// The sources of the shown ticket (ADR-0031 section 7), with its main source.
	$effect(() => {
		const ticket = detail.state === 'ready' ? detail.ticket : null;
		if (ticket === null) return;
		const ticketId = ticket.id;
		const mainSource = ticket.sourceItem;
		untrack(() => sourceStore.open(ticketId, mainSource));
	});

	// Leaving the panel drops the ticket, its comments, its sources and all drafts.
	$effect(() => () => {
		detail.reset();
		comments.reset();
		sourceStore.reset();
		rules.cancelTemplate();
	});

	/** Set once the ticket was deleted or its drafts discarded here: leaving needs no question. */
	let discarding = false;
	/** Navigation held up by the question: its target and, for back/forward, the history step. */
	let leaving = $state<{ url: URL; delta: number | undefined } | null>(null);

	// Leaving the panel within the app (Schließen, Escape, another ticket, "Neues Ticket", browser
	// back) asks first while a description, a comment, a name in the tag picker (E3 plan, T-14) or
	// the template of the series edited here (plan WV) is not saved. beforeNavigate cannot wait for a dialog (ADR-0025 section 4): the navigation is
	// cancelled (SvelteKit restores the history position for back and forward), the confirmation
	// opens (in the full view the inline question instead), and "Verwerfen" starts it again. Logout and session end go to the login page and are
	// not held up; closing the browser tab is not covered.
	beforeNavigate((navigation) => {
		const to = navigation.to;
		if (discarding || navigation.type === 'leave' || to === null) return;
		if (!to.route.id?.startsWith('/(app)/') || to.url.pathname === page.url.pathname) return;
		if (TICKET_ROUTES.includes(to.route.id) && to.params?.id === id) return;
		if (detail.state !== 'ready') return;
		if (!(detail.hasUnsavedInput || comments.dirty || rules.templateDirty)) return;
		navigation.cancel();
		leaving = {
			url: to.url,
			delta: navigation.type === 'popstate' ? navigation.delta : undefined
		};
	});

	async function discardAndLeave() {
		const target = leaving;
		leaving = null;
		if (target === null) return;
		discarding = true;
		if (target.delta !== undefined && target.delta !== 0) history.go(target.delta);
		else await goto(appHref(target.url));
	}

	async function close() {
		await goto(back);
	}

	async function deleted() {
		discarding = true;
		await goto(back);
	}

	/** Number of parts that ask inline (the full view); while one is shown, no confirmation opens. */
	let inlineAskers = $state(0);

	// The full view deletes through the same way out (a flag of this layout) and asks about unsaved
	// text inline, because no dialog opens from it (ADR-0025 section 3).
	setTicketRoute({
		deleted,
		askInline() {
			inlineAskers += 1;
			let ended = false;
			return () => {
				if (ended) return;
				ended = true;
				inlineAskers -= 1;
				// A question the full view was asking goes with it (closing it keeps the ticket).
				leaving = null;
			};
		},
		get leaving() {
			return leaving !== null && inlineAskers > 0;
		},
		stay() {
			leaving = null;
		},
		discard: discardAndLeave
	});
</script>

<svelte:head>
	<title>{detail.ticket ? `${detail.ticket.key} · ` : ''}becauseyoulovejira</title>
</svelte:head>

{#snippet duplicateQuestion(ticket: Ticket, close: () => void)}
	{#if duplicates !== null}
		<DuplicateDialog
			{ticket}
			store={duplicates}
			projects={catalog.activeProjects}
			sources={sourceStore.ticketId === ticket.id ? sourceStore.items : []}
			commentCount={comments.ticketId === ticket.id ? comments.comments.length : 0}
			subtaskCount={tickets.progressOf(ticket.id).total}
			parentKey={ticket.parentId ? (parent?.key ?? null) : null}
			onopen={openTicket}
			onclose={close}
		/>
	{/if}
{/snippet}

{#if !fullView}
	<TicketPanel
		store={detail}
		{catalog}
		listHref={back}
		fullViewHref={full}
		onfullview={() => modeStore?.choose('full')}
		onclose={close}
		ondeleted={deleted}
		sourceCount={sourceStore.ticketId === id ? sourceStore.items.length : 0}
		{parent}
		parentHref={parent ? links.href(parent.id, page.url) : null}
		subtaskCount={tickets.progressOf(id).total}
		duplicate={duplicates === null ? undefined : duplicateQuestion}
		{flags}
	>
		{#snippet parentField(ticket: Ticket)}
			<TicketParentField
				store={detail}
				{ticket}
				{parent}
				parentHref={parent ? links.href(parent.id, page.url) : null}
				subtaskCount={tickets.progressOf(ticket.id).total}
			/>
		{/snippet}
		{#snippet subtasks(ticket: Ticket)}
			{#if !ticket.parentId}
				<TicketSubtasks
					{ticket}
					list={tickets}
					hrefOf={(subtaskId) => links.href(subtaskId, page.url)}
				/>
			{/if}
		{/snippet}
		{#snippet recurrence(ticket: Ticket)}
			<RecurrenceSummary
				{ticket}
				store={rules}
				{catalog}
				today={tickets.today}
				history={comments.history}
				openTickets={ticket.recurrenceId ? openInstancesOf(tickets.open, ticket.recurrenceId) : []}
				subtasks={tickets.subtasksOf(ticket.id)}
				onticket={(changed) => {
					detail.upsert(changed);
					tickets.upsert(changed);
				}}
			/>
		{/snippet}
		{#snippet sources(ticket: Ticket)}
			<TicketSources {ticket} store={sourceStore} candidates={inbox.newItems} />
		{/snippet}
		{#snippet activity()}
			<TicketActivity store={comments} {catalog} pin={detail} />
		{/snippet}
	</TicketPanel>
{/if}

<ConfirmDialog
	open={leaving !== null && inlineAskers === 0}
	title="Änderungen verwerfen?"
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => void discardAndLeave()}
	oncancel={() => (leaving = null)}
>
	<p>Der nicht gespeicherte Text geht verloren.</p>
</ConfirmDialog>

{@render children()}
