<script lang="ts">
	import { page } from '$app/state';
	import { matchesWords, searchWords } from '$lib/domain/ticket-picker';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import DueLabel from '../DueLabel.svelte';
	import KindBadge from '../KindBadge.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import { DRAG_TICKET } from './DayPlanList.svelte';

	// The pool of the day plan (ADR-0065 §4): the open tickets of the area that are not in the plan, in
	// the default order of the list, with a search over key and title (the normalisation of the ticket
	// picker, ADR-0042). Each ticket goes into the plan with "+" (the way on a phone, 44 px) or by
	// dragging it onto the plan, at the place where it is dropped. A long pool shows the first
	// POOL_LIMIT tickets and says how many more the search can find. On a wide screen the pool stands
	// next to the plan, on a narrow one below it (the view decides).
	const POOL_LIMIT = 60;

	let { store }: { store: DayPlanStore } = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const searchId = `${uid}-search`;
	const hintId = `${uid}-hint`;
	const links = ticketLinks();

	let text = $state('');

	const words = $derived(searchWords(text));
	const matching = $derived(store.pool.filter((ticket) => matchesWords(ticket, words)));
	const shown = $derived(matching.slice(0, POOL_LIMIT));
	const more = $derived(matching.length - shown.length);

	function onDragStart(event: DragEvent, ticket: TicketSummary) {
		if (event.dataTransfer === null) return;
		event.dataTransfer.setData(DRAG_TICKET, ticket.id);
		event.dataTransfer.setData('text/plain', `${ticket.key} ${ticket.title}`);
		event.dataTransfer.effectAllowed = 'copy';
	}
</script>

<section class="pool" aria-labelledby={headingId}>
	<h3 id={headingId}>Pool</h3>
	<p class="hint" id={hintId}>
		Offene Tickets dieses Bereichs, die noch nicht im Plan stehen. Mit „+“ aufnehmen oder auf den
		Plan ziehen.
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
			autocomplete="off"
			spellcheck="false"
			placeholder="Key oder Titel"
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
			{#each shown as ticket (ticket.id)}
				{@const pending = store.isPending(ticket.id)}
				<li
					class="ticket"
					draggable="true"
					data-pool-ticket={ticket.id}
					aria-busy={pending ? 'true' : undefined}
					ondragstart={(event) => onDragStart(event, ticket)}
				>
					<span class="title-cell">
						<CharmIcon charm={ticket.charm} />
						<span class="key">{ticket.key}</span>
						<a
							class="title-link"
							href={links.href(ticket.id, page.url)}
							data-ticket-link={ticket.id}>{ticket.title}</a
						>
						<KindBadge kind={ticket.kind} />
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
</section>

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

	.tickets {
		display: grid;
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
</style>
