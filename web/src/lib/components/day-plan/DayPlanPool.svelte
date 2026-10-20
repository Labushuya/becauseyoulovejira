<script lang="ts">
	import { page } from '$app/state';
	import { limitBlocks } from '$lib/domain/subtasks';
	import { matchesWordsWithParent, searchWords } from '$lib/domain/ticket-picker';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import DueLabel from '../DueLabel.svelte';
	import KindBadge from '../KindBadge.svelte';
	import SubtaskNestIcon from '../SubtaskNestIcon.svelte';
	import SubtaskPath from '../SubtaskPath.svelte';
	import SubtaskProgressChip from '../SubtaskProgressChip.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import { DRAG_TICKET } from './DayPlanList.svelte';

	// The pool of the day plan (ADR-0065 §4): the open tickets of the area that are not in the plan, in
	// the default order of the list, arranged like the table "Aufgaben" (TP-3): a parent, directly
	// below it indented its sub-tasks of the pool with the corner, the parent with the chip "2/5". A
	// sub-task whose parent is not in the pool (in the plan, done, unknown, or not found by the
	// search) stands alone and names its parent above its title (TP-2). The search goes over key and
	// title of a ticket and of its parent (TP-3; the normalisation of the ticket picker, ADR-0042):
	// every word in one of them. Each ticket goes into the plan with "+" (the way on a phone, 44 px)
	// or by dragging it onto the plan, at the place where it is dropped. A long pool shows the first
	// POOL_LIMIT tickets in whole blocks of a parent with its sub-tasks and says how many more the
	// search can find. On a wide screen the pool stands next to the plan, on a narrow one below it
	// (the view decides). In the phone frame (MO-2, ADR-0073 addendum MO-2) it is the section
	// "Hinzufügen …" below the plan, folded like the suggestions (the heading is the button,
	// aria-expanded), with the same search and "+"; nothing is dragged there, a long press stays the
	// browser's.
	const POOL_LIMIT = 60;

	let {
		store,
		open = $bindable(false)
	}: {
		store: DayPlanStore;
		/** Whether the folded section of the phone frame is open; the PC always shows the pool. */
		open?: boolean;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const searchId = `${uid}-search`;
	const hintId = `${uid}-hint`;
	const bodyId = `${uid}-body`;
	const links = ticketLinks();
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);

	let text = $state('');

	const words = $derived(searchWords(text));
	const matching = $derived(
		store.pool.filter((ticket) =>
			matchesWordsWithParent(ticket, store.parentTicketOf(ticket), words)
		)
	);
	const rows = $derived(store.arrange(matching, (ticket) => ticket));
	const shown = $derived(limitBlocks(rows, POOL_LIMIT));
	const more = $derived(rows.length - shown.length);

	function onDragStart(event: DragEvent, ticket: TicketSummary) {
		if (event.dataTransfer === null) return;
		event.dataTransfer.setData(DRAG_TICKET, ticket.id);
		event.dataTransfer.setData('text/plain', `${ticket.key} ${ticket.title}`);
		event.dataTransfer.effectAllowed = 'copy';
	}
</script>

<section class="pool" aria-labelledby={headingId}>
	{#if phone}
		<h3 id={headingId}>
			<button
				class="disclosure"
				type="button"
				aria-expanded={open}
				aria-controls={bodyId}
				onclick={() => (open = !open)}
			>
				<svg class="chevron" class:open viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M6 4l4 4-4 4" />
				</svg>
				Hinzufügen …
			</button>
		</h3>
		<div class="body" id={bodyId} hidden={!open}>{@render body()}</div>
	{:else}
		<h3 id={headingId}>Pool</h3>
		{@render body()}
	{/if}
</section>

{#snippet body()}
	<p class="hint" id={hintId}>
		{#if phone}
			Offene Tickets dieses Bereichs, die noch nicht im Plan stehen. Mit „+“ in den Plan aufnehmen.
		{:else}
			Offene Tickets dieses Bereichs, die noch nicht im Plan stehen. Mit „+“ aufnehmen oder auf den
			Plan ziehen.
		{/if}
	</p>
	<div class="search-field">
		<label for={searchId}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="7" cy="7" r="4.25" />
				<path d="M10.25 10.25L13.5 13.5" />
			</svg>
			<span class="visually-hidden">Pool durchsuchen</span>
		</label>
		<input
			id={searchId}
			type="search"
			enterkeyhint="search"
			autocomplete="off"
			spellcheck="false"
			placeholder="Key, Titel oder Hauptticket"
			aria-describedby={hintId}
			bind:value={text}
		/>
	</div>
	{#if store.pool.length === 0}
		<EmptyState size="compact" title="Alle offenen Tickets stehen im Plan" />
	{:else if matching.length === 0}
		<p class="hint" role="status">Kein Ticket passt zu „{text.trim()}“.</p>
	{:else}
		<ul class="tickets">
			{#each shown as { entry: ticket, nested, parent } (ticket.id)}
				{@const pending = store.isPending(ticket.id)}
				<li
					class="ticket"
					class:nested
					draggable={phone ? undefined : 'true'}
					data-pool-ticket={ticket.id}
					aria-busy={pending ? 'true' : undefined}
					ondragstart={(event) => onDragStart(event, ticket)}
				>
					<span class="title-cell">
						{#if parent && nested}
							<!-- Indented below its parent (TP-3): the corner, the parent only for screen readers. -->
							<SubtaskPath {parent} path={false} />
							<SubtaskNestIcon />
						{:else if parent}
							<!-- A sub-task without its parent here names it above its title (TP-2). -->
							<SubtaskPath {parent} withTitle href={links.href(parent.id, page.url)} />
						{/if}
						<CharmIcon charm={ticket.charm} />
						<span class="key">{ticket.key}</span>
						<a
							class="title-link"
							href={links.href(ticket.id, page.url)}
							data-ticket-link={ticket.id}>{ticket.title}</a
						>
						<KindBadge kind={ticket.kind} />
						<SubtaskProgressChip progress={store.progressOf(ticket.id)} />
						{#if ticket.due !== null}
							<span class="due"><DueLabel due={ticket.due} today={store.today} /></span>
						{/if}
					</span>
					<button
						class="button-icon add"
						type="button"
						aria-label={`${ticket.key} zum Tagesplan`}
						title="Zum Tagesplan"
						aria-disabled={pending ? 'true' : undefined}
						aria-busy={pending ? 'true' : undefined}
						onclick={() => {
							if (!pending) void store.add(ticket.id);
						}}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
							<path d="M8 3v10M3 8h10" />
						</svg>
					</button>
				</li>
			{/each}
		</ul>
		{#if more > 0}
			<p class="hint">{more} weitere – die Suche grenzt ein.</p>
		{/if}
	{/if}
{/snippet}

<style>
	.pool {
		display: grid;
		gap: 0.5rem;
		align-content: start;
		min-width: 0;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.search-field input {
		width: 100%;
	}

	/* One column never wider than the pool, also with indented entries (TP-3). */
	.tickets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.ticket {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		min-height: var(--control-height-m);
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: grab;
	}

	/* A sub-task below its parent (TP-3): the whole entry indented, like a row of the table. */
	.ticket.nested {
		margin-left: 1.5rem;
	}

	.title-cell {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.title-link {
		min-width: 0;
		color: var(--color-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.due {
		font-size: var(--font-size-small);
	}

	.add svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
	}

	/* On a phone "+" is the way into the plan: 44 px (ADR-0060 §2). */
	@media (pointer: coarse) {
		.ticket {
			min-height: var(--control-height-touch);
			cursor: default;
		}

		.add {
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
		}
	}

	/*
	 * Phone frame (MO-2, ADR-0073 addendum MO-2): the folded section "Hinzufügen …", its heading a
	 * button of 44 px like "Vorschläge"; open, its content in the gaps of the pool. "+" has its 44 px
	 * from base.css.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .disclosure {
			display: inline-flex;
			gap: 0.375rem;
			align-items: center;
			min-height: var(--control-height-touch);
			padding: 0 0.25rem;
			font: inherit;
			color: var(--color-text);
			background: none;
			border: none;
			border-radius: var(--radius-control);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .chevron {
			width: 0.875rem;
			height: 0.875rem;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linecap: round;
			stroke-linejoin: round;
			transition: transform var(--motion-fast) var(--motion-ease);
		}

		:global(:root[data-mobile-layout='on']) .chevron.open {
			transform: rotate(90deg);
		}

		:global(:root[data-mobile-layout='on']) .body:not([hidden]) {
			display: grid;
			gap: 0.5rem;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .ticket {
			cursor: default;
		}

		@media (prefers-reduced-motion: reduce) {
			:global(:root[data-mobile-layout='on']) .chevron {
				transition: none;
			}
		}
	}
</style>
