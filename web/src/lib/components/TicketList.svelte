<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import { newTicketHref, showDoneFrom, ticketHref, withShowDone } from '$lib/ticket-links';
	import type { TicketSummary } from '$lib/domain/ticket';
	import ErrorIcon from './ErrorIcon.svelte';
	import TicketRow from './TicketRow.svelte';

	// List "Alle Tickets" (E2 plan, P-1 to P-3 and package 5): open tickets in the default order,
	// the switch "Erledigte anzeigen" bound to ?erledigte=1 and, below, the section "Erledigt".
	let {
		store,
		activeId = null,
		creating = false
	}: {
		store: TicketListStore;
		/** Ticket shown in the detail panel; its row is marked as current. */
		activeId?: string | null;
		/** The form "Neues Ticket" is open. */
		creating?: boolean;
	} = $props();

	const uid = $props.id();
	const showDone = $derived(showDoneFrom(page.url));

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();
	let newButton = $state<HTMLElement>();
	/** Row that last had the focus, to restore it when that row moves or disappears. */
	let lastFocus: { id: string; section: string; index: number } | null = null;

	async function toggleShowDone(event: Event & { currentTarget: HTMLInputElement }) {
		await goto(withShowDone(page.url, event.currentTarget.checked), {
			keepFocus: true,
			noScroll: true
		});
	}

	function rowsOf(section: string): HTMLElement[] {
		return [...(root?.querySelectorAll<HTMLElement>(`[data-section="${section}"] > li`) ?? [])];
	}

	function rowOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('li[data-ticket-id]') ?? [])].find(
			(row) => row.dataset.ticketId === id
		);
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function onfocusin(event: FocusEvent) {
		const row = event.target instanceof Element ? event.target.closest('li') : null;
		const section = row?.parentElement?.dataset.section;
		const id = row?.dataset.ticketId;
		if (!row || !section || !id) return;
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
		const neighbour = rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>('a');
		(moved ?? neighbour ?? heading)?.focus();
	}

	$effect(() => {
		// Re-run whenever the rendered rows change.
		void store.open;
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
			(rowOf(previous)?.querySelector<HTMLElement>('a') ?? heading)?.focus();
		});
	});

	/** Whether the form "Neues Ticket" was open. */
	let wasCreating = false;

	// Leaving the form without a new ticket returns the focus to "Neues Ticket".
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (newButton ?? heading)?.focus();
		});
	});
</script>

{#snippet rows(tickets: readonly TicketSummary[], section: string, label: string)}
	<ul class="rows" data-section={section} aria-label={label}>
		{#each tickets as ticket (ticket.id)}
			<TicketRow
				{ticket}
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
	</ul>
{/snippet}

{#snippet failure(message: string, retryLabel: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="text-button" type="button" onclick={onretry}>{retryLabel}</button>
	</div>
{/snippet}

<section
	class="ticket-list"
	aria-labelledby={`${uid}-title`}
	bind:this={root}
	{onfocusin}
	{onfocusout}
>
	<div class="toolbar">
		<h2 id={`${uid}-title`} tabindex="-1" bind:this={heading}>Alle Tickets</h2>
		<label class="switch">
			<input type="checkbox" checked={showDone} onchange={toggleShowDone} />
			Erledigte anzeigen
		</label>
		<a class="button-primary new" href={newTicketHref(page.url)} bind:this={newButton}
			>Neues Ticket</a
		>
	</div>

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
	{:else if store.openState === 'ready' && store.open.length === 0}
		<div class="empty">
			<p>Keine offenen Tickets.</p>
			<a class="button-primary" href={newTicketHref(page.url)}>Neues Ticket</a>
		</div>
	{:else if store.open.length > 0}
		{@render rows(store.open, 'open', 'Offene Tickets')}
	{:else if store.openState === 'loading'}
		<p class="loading" role="status">Tickets werden geladen …</p>
	{/if}

	{#if showDone}
		<section class="done-section" aria-labelledby={`${uid}-done-title`}>
			<h3 id={`${uid}-done-title`}>Erledigt</h3>
			{#if store.doneState === 'error' && store.doneError}
				{@render failure(store.doneError, 'Erneut versuchen', () => store.reload())}
			{:else if store.doneState === 'ready' && store.done.length === 0}
				<p class="empty">Noch keine erledigten Tickets.</p>
			{:else if store.done.length > 0}
				{@render rows(store.done, 'done', 'Erledigte Tickets')}
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
		</section>
	{/if}
</section>

<style>
	.ticket-list {
		container: ticket-list / inline-size;
		min-width: 0;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
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

	.new {
		margin-left: auto;
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.empty .button-primary {
		margin-top: 0.75rem;
		text-decoration: none;
	}

	.rows {
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-bottom: none;
		border-radius: 0.375rem;
		overflow: hidden;
	}

	.done-section {
		margin-top: 1.5rem;
	}

	h3 {
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.empty,
	.loading {
		padding: 1.5rem 0;
		color: var(--color-text-muted);
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
		margin-top: 0.75rem;
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
