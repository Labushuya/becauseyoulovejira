<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { charmOf, charmText } from '$lib/domain/charms';
	import { colorText, ticketColorOf } from '$lib/domain/colors';
	import {
		completedAtOf,
		doneCountText,
		doneTimeLabel,
		hasDoneFilters,
		parseDoneQuery,
		resetDoneFilters
	} from '$lib/domain/done-view';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { rowMenus } from '$lib/overlay/context-menu';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { DoneListStore } from '$lib/stores/done-list.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import {
		findTicketFollowUpStore,
		type TicketFollowUpStore
	} from '$lib/stores/ticket-follow-up.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import { findTicketHost } from '$lib/ticket-host';
	import { withDoneQuery } from '$lib/ticket-links';
	import CharmIcon from '../CharmIcon.svelte';
	import ColorMark from '../ColorMark.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import KindBadge from '../KindBadge.svelte';
	import SectionBar from '../SectionBar.svelte';
	import TicketActions from '../TicketActions.svelte';
	import TicketRowDialogs from '../TicketRowDialogs.svelte';
	import ViewSwitch from '../ViewSwitch.svelte';
	import DoneFilterBar from './DoneFilterBar.svelte';

	// View "Erledigte" (ER-1, ADR-0066): the done tickets of the area of the tab, most recently
	// completed first, in groups by the Berlin day of completion ("Heute", "Gestern", "Diese Woche",
	// "Diesen Monat", then one per month such as "September 2026"), each a section with a heading and
	// a list. The section bar names their number on all pages; the filter bar narrows them (search,
	// project, tag, charm). Further pages come when the end of the list scrolls into view (an
	// IntersectionObserver on a mark below it) and with the button "Mehr laden", the way for keyboard
	// and screen readers; once the last page is there, the focus goes from the button to the first
	// new entry. Every entry shows key and title (one link, it opens the ticket next to the view in
	// the remembered way, ADR-0036 §1), the charm before the title (ADR-0062), the badge "Vorhaben"
	// (ADR-0065), the project and the time of completion, and ends with the menu "•••" of every
	// ticket row (TicketActions): open, "Wieder öffnen" with "Rückgängig" in its flag, "Duplizieren …"
	// (ADR-0045), "Folge-Ticket anlegen …" (ADR-0067) and what every row has; a right click or Shift+F10 open it (rowMenus). If the entry
	// with the focus leaves (reopened, here or elsewhere), the focus goes to the entry now at its
	// place, else to the heading.
	let {
		store,
		catalog,
		rowActions = null,
		duplicates = null,
		followUps = findTicketFollowUpStore(),
		subtaskCountOf = () => 0,
		parentKeyOf = () => null,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		store: DoneListStore;
		catalog: CatalogStore;
		/** The menu "•••" of every entry; without it the entries have none. */
		rowActions?: TicketRowActionsStore | null;
		/** "Duplizieren …" in that menu (ADR-0045); null leaves the entry out. */
		duplicates?: TicketDuplicateStore | null;
		/** "Folge-Ticket anlegen …" in that menu (ADR-0067); null leaves the entry out. */
		followUps?: TicketFollowUpStore | null;
		/** Number of sub-tasks of a ticket (the questions of the menu). */
		subtaskCountOf?: (ticketId: string) => number;
		/** Key of the parent of a sub-task, null for a top-level ticket. */
		parentKeyOf?: (ticket: TicketSummary) => string | null;
		inboxCount?: number | null;
		projectsNewCount?: number;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const links = ticketLinks();
	const host = findTicketHost();
	/** Titles from this length name themselves on hover; the line clamp may cut them (ADR-0030). */
	const LONG_TITLE = 60;

	let heading = $state<HTMLElement>();
	let list = $state<HTMLElement>();
	let more = $state<HTMLButtonElement>();
	let sentinel = $state<HTMLElement>();

	const query = $derived(parseDoneQuery(page.url.searchParams));
	const filtered = $derived(hasDoneFilters(query));
	const today = $derived(store.today);
	const total = $derived(store.total);
	const countReady = $derived(store.state === 'ready' && total !== null);
	const shownTickets = $derived(store.tickets.length);

	async function clearFilters() {
		await goto(withDoneQuery(page.url, resetDoneFilters()), { keepFocus: true, noScroll: true });
		heading?.focus();
	}

	// The end of the list in view loads the next page. The observer starts anew after every page, so
	// a short page that leaves the mark in view loads the next one as well.
	$effect(() => {
		const element = sentinel;
		void shownTickets;
		if (element === undefined || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void store.loadMore();
			},
			{ rootMargin: '0px 0px 200px 0px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** "Mehr laden": once the last page is there, the button goes and the focus to the first new entry. */
	async function loadMore() {
		const before = store.tickets.length;
		await store.loadMore();
		await tick();
		if (more?.isConnected || !focusLost()) return;
		const entries = list?.querySelectorAll<HTMLElement>('a[data-row-link]') ?? [];
		(entries[before] ?? entries[entries.length - 1] ?? heading)?.focus();
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	/** The focused element of an entry before the list changes, and the place of its entry. */
	let focused: HTMLElement | null = null;
	let focusedIndex = 0;

	$effect.pre(() => {
		void store.tickets;
		const active = document.activeElement;
		const item = active instanceof HTMLElement ? active.closest('li[data-ticket-id]') : null;
		if (item === null || list === undefined || !list.contains(item)) {
			focused = null;
			return;
		}
		focused = active as HTMLElement;
		focusedIndex = [...list.querySelectorAll('li[data-ticket-id]')].indexOf(item);
	});

	$effect(() => {
		void store.tickets;
		const lost = focused;
		focused = null;
		if (lost === null || lost.isConnected || !focusLost()) return;
		const entries = list?.querySelectorAll<HTMLElement>('a[data-row-link]') ?? [];
		(entries[Math.min(focusedIndex, entries.length - 1)] ?? heading)?.focus();
	});

	/** "In den Papierkorb …" of an entry: it leaves at once; its realtime event follows. */
	async function moveToTrash(ticketId: string, sources?: DeleteSources): Promise<DeleteResult> {
		if (rowActions === null) return { ok: false, message: null };
		const result = await rowActions.deleteTicket(sources);
		if (result.ok) store.remove(ticketId);
		return result;
	}
</script>

<!-- One done ticket: key and title as one link, badge, project, time of completion and "•••". -->
{#snippet entry(ticket: TicketSummary)}
	{@const project = catalog.projectOf(ticket)}
	{@const color = ticketColorOf(ticket, project)}
	{@const charm = charmOf(ticket.charm)}
	{@const completed = completedAtOf(ticket)}
	<li
		class="ticket"
		data-ticket-id={ticket.id}
		data-menu-row={rowActions ? '' : undefined}
		aria-busy={store.isPending(ticket.id) || rowActions?.isPreparing(ticket.id)
			? 'true'
			: undefined}
	>
		<a
			class="link"
			href={links.href(ticket.id, page.url)}
			data-row-link
			data-ticket-link={ticket.id}
			title={ticket.title.length >= LONG_TITLE ? ticket.title : undefined}
		>
			{#if color}<ColorMark shown={color} named={false} />{/if}
			<span class="key">{ticket.key}</span>
			<span class="title"><CharmIcon charm={charm?.key} named={false} />{ticket.title}</span>
			{#if color}<span class="visually-hidden">, {colorText(color)}</span>{/if}
			{#if charm}<span class="visually-hidden">, {charmText(charm)}</span>{/if}
		</a>
		<span class="details">
			<KindBadge kind={ticket.kind} />
			<span class="project-cell">
				{#if project !== null}
					<span class="visually-hidden">Projekt:&nbsp;</span><span
						title={projectChoiceLabel(project)}>{projectPath(project)}</span
					>
				{/if}
			</span>
			<span class="time-cell">
				<span class="visually-hidden">Erledigt:&nbsp;{formatBerlinDateTime(completed)}</span>
				<time datetime={completed.replace(' ', 'T')} aria-hidden="true"
					>{doneTimeLabel(completed, today)}</time
				>
			</span>
			{#if rowActions}
				{@const actions = rowActions}
				<span class="menu">
					<TicketActions
						{ticket}
						flags={actions.flags}
						open={{
							panel: host.panel(ticket.id, page.url),
							full: host.full(ticket.id, page.url)
						}}
						buttonLabel={`Weitere Aktionen für ${ticket.key}`}
						buttonClass="button-icon row-menu"
						onreopen={() => void store.reopen(ticket.id)}
						reopenBusy={store.isPending(ticket.id)}
						onduplicate={duplicates === null
							? null
							: () => void actions.choose('duplicate', ticket)}
						onfollowup={followUps === null ? null : () => void actions.choose('followup', ticket)}
						ondelete={() => void actions.choose('delete', ticket)}
					/>
				</span>
			{/if}
		</span>
	</li>
{/snippet}

<section class="done-view" aria-labelledby={headingId}>
	<SectionBar
		title="Erledigte"
		{headingId}
		count={countReady ? total : null}
		countLabel={total === null ? '' : doneCountText(total)}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="done" {inboxCount} {projectsNewCount} />
		{/snippet}
	</SectionBar>

	<DoneFilterBar {catalog} searchBusy={store.state === 'loading' && query.search !== null} />

	<p class="visually-hidden" aria-live="polite">{store.announcement}</p>

	{#if store.state === 'error' && store.error}
		<div class="alert-error failure">
			<ErrorIcon />
			<span class="failure-text">{store.error}</span>
			<button class="button-secondary button-small" type="button" onclick={() => store.reload()}
				>Erneut versuchen</button
			>
		</div>
	{:else if store.state === 'ready' && store.tickets.length === 0}
		{#if filtered}
			<EmptyState
				icon="search"
				title="Keine erledigten Tickets für diese Filter"
				description="Ändere die Filter oder setze sie zurück, um wieder alle erledigten Tickets zu sehen."
			>
				{#snippet primary()}
					<button class="button-primary" type="button" onclick={clearFilters}>
						Filter zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState
				icon="check"
				title="Noch keine erledigten Tickets"
				description="Was du in „Aufgaben“ abhakst, steht hier, das zuletzt Erledigte oben."
			/>
		{/if}
	{:else if store.state === 'loading' && store.tickets.length === 0}
		<p class="loading" role="status">Erledigte Tickets werden geladen …</p>
	{/if}

	{#if store.tickets.length > 0}
		<div class="groups" bind:this={list} aria-busy={store.state === 'loading'} {@attach rowMenus}>
			{#each store.groups as group (group.key)}
				{@const groupHeading = `${uid}-group-${group.key}`}
				<section class="group" aria-labelledby={groupHeading}>
					<h3 class="group-head" id={groupHeading}>
						{group.label}<span class="group-count"
							><span aria-hidden="true">{group.tickets.length}</span><span class="visually-hidden"
								>, {doneCountText(group.tickets.length)}</span
							></span
						>
					</h3>
					<ul class="tickets">
						{#each group.tickets as ticket (ticket.id)}
							{@render entry(ticket)}
						{/each}
					</ul>
				</section>
			{/each}
		</div>

		{#if store.moreError}
			<div class="alert-error failure">
				<ErrorIcon />
				<span class="failure-text"
					>Weitere Tickets konnten nicht geladen werden. {store.moreError}</span
				>
				<button class="button-secondary button-small" type="button" onclick={loadMore}
					>Erneut versuchen</button
				>
			</div>
		{:else if store.hasMore}
			<div class="more" bind:this={sentinel}>
				<button
					class="button-secondary"
					type="button"
					aria-busy={store.loadingMore ? 'true' : undefined}
					bind:this={more}
					onclick={loadMore}
				>
					{store.loadingMore ? 'Wird geladen …' : 'Mehr laden'}
				</button>
				{#if total !== null}
					<span class="shown">{store.tickets.length} von {total} angezeigt</span>
				{/if}
			</div>
		{/if}
	{/if}
</section>

<!-- The questions of the menu of an entry (plan aktionsmenues, AM-2): the view is no modal, so they
     open as dialogs, and the modal gives the focus back to "•••" (or the heading). -->
{#if rowActions}
	<TicketRowDialogs
		{rowActions}
		{duplicates}
		{followUps}
		projects={catalog.activeProjects}
		{subtaskCountOf}
		{parentKeyOf}
		onopen={(id) => void goto(links.href(id, page.url))}
		moveToTrash={(id, sources) => moveToTrash(id, sources)}
	/>
{/if}

<style>
	.done-view {
		min-width: 0;
	}

	.loading {
		padding: 1.5rem 0;
		color: var(--color-text-muted);
		animation: reveal 0s 0.4s both;
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.failure {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.failure-text {
		flex: 1;
	}

	.groups {
		display: grid;
		gap: 1.25rem;
	}

	.group-head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0 0 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.group-count {
		min-width: 1.25rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.tickets {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	/* Key and title first; the details stand beside them, or below them when the line is narrow. */
	.ticket {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.75rem;
		align-items: center;
		min-width: 0;
		padding: 0.375rem 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.ticket:first-child {
		border-top: none;
	}

	.link {
		display: flex;
		flex: 1 1 14rem;
		gap: 0.5rem;
		align-items: baseline;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.link:hover .title {
		text-decoration: underline;
	}

	.key {
		flex: none;
		width: 5.5rem;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--color-text-muted);
	}

	/* Two lines at most, like the titles of the tables (ADR-0030 section 6). */
	.title {
		display: -webkit-box;
		min-width: 0;
		overflow: hidden;
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* Fixed places, so the details line up like columns; they wrap as a block, never sideways. */
	.details {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		max-width: 100%;
		margin-left: auto;
	}

	.project-cell {
		width: 9rem;
		overflow: hidden;
		font-size: var(--font-size-control);
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--color-text-muted);
	}

	.time-cell {
		width: 5.5rem;
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text-muted);
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-top: 1rem;
	}

	.shown {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
