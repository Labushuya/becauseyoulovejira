<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import RecurrenceSummary from '$lib/components/RecurrenceSummary.svelte';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import TicketSources from '$lib/components/TicketSources.svelte';
	import TicketSubtasks from '$lib/components/TicketSubtasks.svelte';
	import { parentOf } from '$lib/domain/subtasks';
	import type { Ticket } from '$lib/domain/ticket';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { appHref, fullViewHref, listHref, ticketHref } from '$lib/ticket-links';
	import { setTicketRoute } from '$lib/ticket-route';

	// Detail panel of /tickets/<record id> (E2 plan, T-4) and the full view /tickets/<id>/voll below
	// it (ADR-0025 section 7): this layout loads the ticket and its comments once for both, holds the
	// question about unsaved text and renders the panel; the full view lies over it as a modal. A
	// reload opens the same panel or full view.
	let { children } = $props();

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
	// The parent of a sub-task for its path (ADR-0033), as the list knows it.
	const parent = $derived(
		detail.state === 'ready' && detail.ticket
			? parentOf(detail.ticket, (parentId) => tickets.find(parentId))
			: null
	);

	/** Panel and full view of the same ticket: moving between them keeps drafts and asks nothing. */
	const TICKET_ROUTES = ['/(app)/(tickets)/tickets/[id]', '/(app)/(tickets)/tickets/[id]/voll'];

	$effect(() => {
		const current = id;
		untrack(() => {
			// Another ticket in the same panel: its drafts are new, so leaving asks again.
			discarding = false;
			detail.open(current);
			comments.open(current);
		});
	});

	// Opening a ticket in the panel marks it as read (ADR-0015 section 3), in every tab.
	$effect(() => {
		const ticket = detail.state === 'ready' ? detail.ticket : null;
		if (ticket !== null) untrack(() => void tickets.markRead(ticket));
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
	});

	/** Set once the ticket was deleted or its drafts discarded here: leaving needs no question. */
	let discarding = false;
	/** Navigation held up by the question: its target and, for back/forward, the history step. */
	let leaving = $state<{ url: URL; delta: number | undefined } | null>(null);

	// Leaving the panel within the app (Schließen, Escape, another ticket, "Neues Ticket", browser
	// back) asks first while a description, a comment or a name in the tag picker (E3 plan, T-14) is
	// not saved. beforeNavigate cannot wait for a dialog (ADR-0025 section 4): the navigation is
	// cancelled (SvelteKit restores the history position for back and forward), the confirmation
	// opens, and "Verwerfen" starts it again. Logout and session end go to the login page and are
	// not held up; closing the browser tab is not covered.
	beforeNavigate((navigation) => {
		const to = navigation.to;
		if (discarding || navigation.type === 'leave' || to === null) return;
		if (!to.route.id?.startsWith('/(app)/') || to.url.pathname === page.url.pathname) return;
		if (TICKET_ROUTES.includes(to.route.id) && to.params?.id === id) return;
		if (detail.state !== 'ready' || !(detail.hasUnsavedInput || comments.dirty)) return;
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

	// The full view deletes through the same way out (a flag of this layout).
	setTicketRoute({ deleted });
</script>

<svelte:head>
	<title>{detail.ticket ? `${detail.ticket.key} · ` : ''}becauseyoulovejira</title>
</svelte:head>

<TicketPanel
	store={detail}
	{catalog}
	listHref={back}
	fullViewHref={full}
	onclose={close}
	ondeleted={deleted}
	sourceCount={sourceStore.ticketId === id ? sourceStore.items.length : 0}
	{parent}
	parentHref={parent ? ticketHref(parent.id, page.url) : null}
>
	{#snippet subtasks(ticket: Ticket)}
		{#if !ticket.parentId}
			<TicketSubtasks
				{ticket}
				list={tickets}
				hrefOf={(subtaskId) => ticketHref(subtaskId, page.url)}
			/>
		{/if}
	{/snippet}
	{#snippet recurrence(ticket: Ticket)}
		<RecurrenceSummary
			{ticket}
			store={rules}
			today={tickets.today}
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
		<TicketActivity store={comments} {catalog} />
	{/snippet}
</TicketPanel>

<ConfirmDialog
	open={leaving !== null}
	title="Änderungen verwerfen?"
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => void discardAndLeave()}
	oncancel={() => (leaving = null)}
>
	<p>Der nicht gespeicherte Text geht verloren.</p>
</ConfirmDialog>

{@render children()}
