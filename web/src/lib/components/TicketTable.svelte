<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		NEW_TICKET_LINK_ID,
		newTicketHref,
		showDoneFrom,
		ticketHref,
		withShowDone
	} from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionBar from './SectionBar.svelte';
	import TicketTableRow from './TicketTableRow.svelte';

	// Ticket table (E3 plan, T-4 and package 5; E2 plan, P-1 to P-5): section bar "Aufgaben" with
	// the switch "Erledigte anzeigen" (?erledigte=1), open tickets in the default order and, in a
	// section of their own below, the done tickets with "Weitere laden". Project and tags come
	// from the catalog. Wider than its space (next to the panel), the table scrolls sideways in a
	// named region; the page itself does not.
	let {
		store,
		catalog,
		activeId = null,
		creating = false
	}: {
		store: TicketListStore;
		catalog: CatalogStore;
		/** Ticket shown in the detail panel; its row is marked as current. */
		activeId?: string | null;
		/** The form "Neues Ticket" is open. */
		creating?: boolean;
	} = $props();

	/** Columns of the table (T-4); the section rows span all of them. */
	const COLUMNS = 9;

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		caption: `${uid}-caption`,
		done: `${uid}-done`
	};
	const showDone = $derived(showDoneFrom(page.url));
	const visibleCount = $derived(store.visible.filter((ticket) => ticket.status !== 'done').length);
	const hasOpenRows = $derived(store.visible.length > 0);

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
		count={store.openState === 'ready' ? visibleCount : null}
		countLabel={visibleCount === 1 ? '1 Ticket' : `${visibleCount} Tickets`}
		bind:heading
	>
		{#snippet end()}
			<label class="switch">
				<input type="checkbox" checked={showDone} onchange={toggleShowDone} />
				Erledigte anzeigen
			</label>
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
	{:else if store.openState === 'ready' && !hasOpenRows}
		<div class="empty">
			<p>Keine offenen Tickets.</p>
			<a class="button-primary" href={newTicketHref(page.url)}>Neues Ticket</a>
		</div>
	{:else if store.openState === 'loading' && !hasOpenRows}
		<p class="loading" role="status">Tickets werden geladen …</p>
	{/if}

	{#if hasOpenRows || showDone}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="scroll" role="region" aria-labelledby={ids.caption} tabindex="0">
			<table>
				<caption id={ids.caption}>
					Tickets<span class="caption-order"> · Standard-Reihenfolge</span>
				</caption>
				<thead>
					<tr>
						<th scope="col">Key</th>
						<th scope="col">
							<span aria-hidden="true">Prio</span><span class="visually-hidden">Priorität</span>
						</th>
						<th scope="col">Status</th>
						<th scope="col" class="title-col">Titel</th>
						<th scope="col">Projekt</th>
						<th scope="col">Tags</th>
						<th scope="col">Fällig</th>
						<th scope="col">Erstellt</th>
						<th scope="col"><span class="visually-hidden">Aktionen</span></th>
					</tr>
				</thead>
				{#if hasOpenRows}
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
									<p class="muted">Noch keine erledigten Tickets.</p>
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

	.section-foot td {
		padding: 0.5rem 0.75rem;
	}

	.section-foot td:empty {
		padding: 0;
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
