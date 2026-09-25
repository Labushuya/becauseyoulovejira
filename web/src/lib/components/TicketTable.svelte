<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { GROUPING_LABELS } from '$lib/domain/grouping';
	import { SORT_COLUMN_LABELS, sortLabel, sortOrderLabel } from '$lib/domain/labels';
	import { hasFilters, parseListQuery, resetFilters } from '$lib/domain/list-query';
	import { nextSort, sortDirection, type SortKey } from '$lib/domain/ordering';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		NEW_TICKET_LINK_ID,
		newTicketHref,
		ticketHref,
		withListQuery,
		withShowDone
	} from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import GroupPopover from './GroupPopover.svelte';
	import SectionBar from './SectionBar.svelte';
	import TicketTableRow from './TicketTableRow.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Ticket table (E3 plan, T-4 and packages 5, 9, 10, 13 and 14; E2 plan, P-1 to P-5): section
	// bar "Aufgaben" with the number of shown tickets, the switch "Aufgaben | Projekte", the switch
	// "Erledigte anzeigen" (?erledigte=1) and the popover "Gruppieren"; the open tickets that pass
	// the filters (the store holds the query of the URL) in the column sort of the URL or the
	// default order, with a grouping in one tbody per group; and, in a section of their own below,
	// the done tickets with "Weitere laden", always most recently completed first and never
	// grouped. Sort buttons sit in the column headers (T-5). Project and tags come from the
	// catalog. Wider than its space (next to the panel), the table scrolls sideways in a named
	// region; the page itself does not.
	let {
		store,
		catalog,
		activeId = null,
		creating = false,
		inboxCount = null
	}: {
		store: TicketListStore;
		catalog: CatalogStore;
		/** Ticket shown in the detail panel; its row is marked as current. */
		activeId?: string | null;
		/** The form "Neues Ticket" is open. */
		creating?: boolean;
		/** New inbox entries for the switch (E4 plan, package 3). */
		inboxCount?: number | null;
	} = $props();

	/** Columns of the table (T-4); the section rows span all of them. */
	const COLUMNS = 9;

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		caption: `${uid}-caption`,
		done: `${uid}-done`,
		switchHint: `${uid}-switch-hint`
	};
	const query = $derived(store.query);
	const filtered = $derived(hasFilters(query));
	const showDone = $derived(store.showDone);
	/** Only the section "Erledigt" is shown (status filter "Erledigt"). */
	const onlyDone = $derived(query.status === 'done');
	const hasOpenRows = $derived(store.visible.length > 0);
	const countReady = $derived(
		store.openState === 'ready' && (!onlyDone || store.doneState === 'ready')
	);
	const countLabel = $derived.by(() => {
		const count = store.visibleCount;
		if (store.visibleCountMore) return `mehr als ${count} Tickets`;
		return count === 1 ? '1 Ticket' : `${count} Tickets`;
	});
	/**
	 * With a status filter the switch has no effect (T-6): "Erledigt" shows the done tickets
	 * anyway, any other status hides them. The switch is locked with this hint.
	 */
	const switchHint = $derived.by(() => {
		if (query.status === null) return null;
		return onlyDone
			? 'Der Statusfilter „Erledigt“ zeigt nur erledigte Tickets.'
			: 'Bei einem anderen Statusfilter als „Erledigt“ sind erledigte Tickets ausgeblendet.';
	});

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();
	/** Row that last had the focus, to restore it when that row moves or disappears. */
	let lastFocus: { id: string; section: string; index: number } | null = null;

	async function toggleShowDone(event: Event & { currentTarget: HTMLInputElement }) {
		await goto(withShowDone(page.url, event.currentTarget.checked), {
			keepFocus: true,
			noScroll: true
		});
	}

	/** Locked switch (aria-disabled keeps it focusable for its hint): a click changes nothing. */
	function keepSwitch(event: MouseEvent) {
		if (switchHint !== null) event.preventDefault();
	}

	/** "Filter zurücksetzen" of the empty result; the focus goes to the heading "Aufgaben". */
	async function clearFilters() {
		await goto(withListQuery(page.url, resetFilters(query)), { keepFocus: true, noScroll: true });
		heading?.focus();
	}

	/**
	 * Click cycle of a column header (T-5): natural direction, reversed, default order. It is a
	 * navigation with a history entry, so back restores the previous sort; the focus stays on the
	 * button.
	 */
	async function sortBy(key: SortKey) {
		const current = parseListQuery(page.url.searchParams);
		await goto(withListQuery(page.url, { ...current, sort: nextSort(current.sort, key) }), {
			keepFocus: true,
			noScroll: true
		});
	}

	function rowsOf(section: string): HTMLElement[] {
		return [
			...(root?.querySelectorAll<HTMLElement>(
				`tbody[data-section="${section}"] > tr[data-ticket-id]`
			) ?? [])
		];
	}

	function rowOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('tr[data-ticket-id]') ?? [])].find(
			(row) => row.dataset.ticketId === id
		);
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function onfocusin(event: FocusEvent) {
		const row = event.target instanceof Element ? event.target.closest('tr[data-ticket-id]') : null;
		if (!(row instanceof HTMLElement)) return;
		const section = row.parentElement?.dataset.section;
		const id = row.dataset.ticketId;
		if (!section || !id) return;
		lastFocus = { id, section, index: rowsOf(section).indexOf(row) };
	}

	function onfocusout(event: FocusEvent) {
		// Focus moved elsewhere on purpose; a removed element reports no related target.
		if (event.relatedTarget instanceof Node && !root?.contains(event.relatedTarget)) {
			lastFocus = null;
		}
	}

	/**
	 * Keyboard focus after rows moved or vanished (checked, unchecked, undo expired): back to the
	 * check mark of the same ticket, else to the row now at the same place, else to the heading.
	 */
	function restoreFocus() {
		if (lastFocus === null || !focusLost()) return;
		const { id, section, index } = lastFocus;
		const moved = rowOf(id)?.querySelector<HTMLElement>('input');
		const rows = rowsOf(section);
		const neighbour =
			rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>('a.title-link');
		(moved ?? neighbour ?? heading)?.focus();
	}

	$effect(() => {
		// Re-run whenever the rendered rows change.
		void store.visible;
		void store.groups;
		void store.done;
		restoreFocus();
	});

	/** Ticket whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (button, Escape, browser back) returns the focus to the row of its
	// ticket, or to the heading if the row is gone (E2 plan, section 3).
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(rowOf(previous)?.querySelector<HTMLElement>('a.title-link') ?? heading)?.focus();
		});
	});

	/** Whether the form "Neues Ticket" was open. */
	let wasCreating = false;

	// Leaving the form without a new ticket returns the focus to "Neues Ticket" in the header.
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (document.getElementById(NEW_TICKET_LINK_ID) ?? heading)?.focus();
		});
	});
</script>

{#snippet rows(tickets: readonly TicketSummary[])}
	{#each tickets as ticket (ticket.id)}
		<TicketTableRow
			{ticket}
			project={catalog.projectOf(ticket)}
			tags={catalog.tagsOf(ticket)}
			href={ticketHref(ticket.id, page.url)}
			today={store.today}
			checked={store.isChecked(ticket)}
			pending={store.isPending(ticket.id)}
			lingering={store.isLingering(ticket.id)}
			active={ticket.id === activeId}
			ontoggle={(done) => store.setDone(ticket.id, done)}
			onundo={() => store.undo(ticket.id)}
		/>
	{/each}
{/snippet}

{#snippet sortable(key: SortKey, text: string, className = '')}
	{@const sorted = query.sort?.key === key ? query.sort : null}
	{@const direction = sorted === null ? null : sortDirection(sorted)}
	<th scope="col" class={className} aria-sort={direction ?? undefined}>
		<button class="sort" class:sorted={sorted !== null} type="button" onclick={() => sortBy(key)}>
			<span aria-hidden="true">{text}</span>
			<span class="visually-hidden">
				Nach {SORT_COLUMN_LABELS[key]} sortieren{sorted === null
					? ''
					: `, sortiert: ${sortOrderLabel(sorted)}`}
			</span>
			<svg
				class="sort-icon"
				data-direction={direction ?? 'none'}
				viewBox="0 0 12 12"
				aria-hidden="true"
				focusable="false"
			>
				{#if direction === 'ascending'}
					<path d="M6 2.5v7M3 5.5l3-3 3 3" />
				{:else if direction === 'descending'}
					<path d="M6 2.5v7M3 6.5l3 3 3-3" />
				{:else}
					<path d="M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5" />
				{/if}
			</svg>
		</button>
	</th>
{/snippet}

{#snippet failure(message: string, retryLabel: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="text-button" type="button" onclick={onretry}>{retryLabel}</button>
	</div>
{/snippet}

<section
	class="ticket-table"
	aria-labelledby={ids.heading}
	bind:this={root}
	{onfocusin}
	{onfocusout}
>
	<SectionBar
		title="Aufgaben"
		headingId={ids.heading}
		count={countReady ? `${store.visibleCount}${store.visibleCountMore ? '+' : ''}` : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="tasks" {inboxCount} />
		{/snippet}
		{#snippet end()}
			<label class="switch" class:locked={switchHint !== null}>
				<input
					type="checkbox"
					checked={showDone}
					aria-disabled={switchHint === null ? undefined : 'true'}
					aria-describedby={switchHint === null ? undefined : ids.switchHint}
					onclick={keepSwitch}
					onchange={toggleShowDone}
				/>
				Erledigte anzeigen
			</label>
			{#if switchHint !== null}
				<span class="switch-hint" id={ids.switchHint}>{switchHint}</span>
			{/if}
			<GroupPopover />
		{/snippet}
	</SectionBar>

	<p class="visually-hidden" aria-live="polite">{store.announcement}</p>
	<div aria-live="assertive">
		{#if store.notice}
			<div class="alert-error notice">
				<ErrorIcon />
				<span class="failure-text">{store.notice}</span>
				<button class="text-button" type="button" onclick={() => store.dismissNotice()}>
					Schließen
				</button>
			</div>
		{/if}
	</div>

	{#if store.openState === 'error' && store.openError}
		{@render failure(store.openError, 'Erneut versuchen', () => store.reload())}
	{:else if store.openState === 'ready' && !hasOpenRows && !onlyDone}
		{#if filtered}
			<div class="empty">
				<p>Keine Tickets für diese Filter.</p>
				<button class="text-button reset" type="button" onclick={clearFilters}>
					Filter zurücksetzen
				</button>
			</div>
		{:else}
			<div class="empty">
				<p>Keine offenen Tickets.</p>
				<a class="button-primary" href={newTicketHref(page.url)}>Neues Ticket</a>
			</div>
		{/if}
	{:else if store.openState === 'loading' && !hasOpenRows}
		<p class="loading" role="status">Tickets werden geladen …</p>
	{/if}

	{#if hasOpenRows || showDone}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="scroll" role="region" aria-labelledby={ids.caption} tabindex="0">
			<table>
				<caption id={ids.caption}>
					Tickets<span class="caption-order">
						· {query.sort === null
							? 'Standard-Reihenfolge'
							: `sortiert nach ${sortLabel(query.sort)}`}{query.grouping === null
							? ''
							: ` · gruppiert nach ${GROUPING_LABELS[query.grouping]}`}
					</span>
				</caption>
				<thead>
					<tr>
						{@render sortable('key', 'Key')}
						{@render sortable('priority', 'Prio')}
						{@render sortable('status', 'Status')}
						{@render sortable('title', 'Titel', 'title-col')}
						{@render sortable('project', 'Projekt')}
						<th scope="col">Tags</th>
						{@render sortable('due', 'Fällig')}
						{@render sortable('created', 'Erstellt')}
						<th scope="col"><span class="visually-hidden">Aktionen</span></th>
					</tr>
				</thead>
				{#if hasOpenRows && store.groups !== null}
					{#each store.groups as group (group.key)}
						{@const count = group.tickets.filter((ticket) => ticket.status !== 'done').length}
						<tbody
							data-section="open"
							data-group={group.key}
							aria-labelledby={`${uid}-group-${group.key}`}
						>
							<tr class="section-head group-head">
								<th scope="rowgroup" colspan={COLUMNS} id={`${uid}-group-${group.key}`}>
									{group.label}<span class="group-count"
										><span aria-hidden="true">{count}</span><span class="visually-hidden"
											>, {count === 1 ? '1 Ticket' : `${count} Tickets`}</span
										></span
									>
								</th>
							</tr>
							{@render rows(group.tickets)}
						</tbody>
					{/each}
				{:else if hasOpenRows}
					<tbody data-section="open" aria-label="Offene Tickets">
						{@render rows(store.visible)}
					</tbody>
				{/if}
				{#if showDone}
					<tbody data-section="done" aria-labelledby={ids.done}>
						<tr class="section-head">
							<th scope="rowgroup" colspan={COLUMNS} id={ids.done}>
								Erledigt – zuletzt erledigte zuerst
							</th>
						</tr>
						{@render rows(store.done)}
						<tr class="section-foot">
							<td colspan={COLUMNS}>
								{#if store.doneState === 'error' && store.doneError}
									{@render failure(store.doneError, 'Erneut versuchen', () => store.reload())}
								{:else if store.doneState === 'ready' && store.done.length === 0}
									{#if !filtered}
										<p class="muted">Noch keine erledigten Tickets.</p>
									{:else if onlyDone}
										<p class="muted">Keine Tickets für diese Filter.</p>
										<button class="text-button reset" type="button" onclick={clearFilters}>
											Filter zurücksetzen
										</button>
									{:else}
										<p class="muted">Keine erledigten Tickets für diese Filter.</p>
									{/if}
								{:else if store.done.length > 0}
									{#if store.doneState === 'ready' && store.doneError}
										{@render failure(store.doneError, 'Weitere laden', () => store.loadMoreDone())}
									{:else if store.doneHasMore}
										<button
											class="more"
											type="button"
											disabled={store.loadingMoreDone}
											onclick={() => store.loadMoreDone()}
										>
											{store.loadingMoreDone ? 'Wird geladen …' : 'Weitere laden'}
										</button>
									{/if}
								{:else if store.doneState === 'loading'}
									<p class="loading" role="status">Erledigte Tickets werden geladen …</p>
								{/if}
							</td>
						</tr>
					</tbody>
				{/if}
			</table>
		</div>
	{/if}
</section>

<style>
	.ticket-table {
		min-width: 0;
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.switch.locked {
		cursor: not-allowed;
	}

	.switch-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.switch input {
		accent-color: var(--color-brand);
	}

	.scroll {
		overflow-x: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	.scroll:focus-visible {
		outline-offset: 2px;
	}

	table {
		width: 100%;
		min-width: 60rem;
		font-size: 0.875rem;
		border-collapse: collapse;
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.caption-order {
		font-weight: 400;
	}

	thead th {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.sort {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0;
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
	}

	.sort:hover,
	.sort.sorted {
		color: var(--color-text);
	}

	.sort-icon {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.sort-icon[data-direction='none'] {
		opacity: 0.45;
	}

	.sort.sorted .sort-icon {
		color: var(--color-brand-text);
	}

	.title-col {
		width: 100%;
	}

	.section-head th {
		padding: 1rem 0.75rem 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.group-head th {
		padding-top: 0.75rem;
		color: var(--color-text);
	}

	.group-count {
		display: inline-block;
		min-width: 1.5rem;
		margin-left: 0.5rem;
		padding: 0 0.375rem;
		font-size: 0.75rem;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.625rem;
	}

	.section-foot td {
		padding: 0.5rem 0.75rem;
	}

	.section-foot td:empty {
		padding: 0;
	}

	.reset {
		margin-top: 0.5rem;
	}

	.empty .button-primary {
		margin-top: 0.75rem;
		text-decoration: none;
	}

	.empty,
	.loading,
	.muted {
		color: var(--color-text-muted);
	}

	.empty,
	.loading {
		padding: 1.5rem 0;
	}

	.empty {
		margin-bottom: 1rem;
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.failure,
	.notice {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.section-foot .failure {
		margin-bottom: 0;
	}

	.failure-text {
		flex: 1;
	}

	.text-button {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.more {
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.more:disabled {
		cursor: progress;
	}
</style>
