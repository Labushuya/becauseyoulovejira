<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import type { TicketOriginsStore } from '$lib/stores/ticket-origins.svelte';
	import StatusPill from './StatusPill.svelte';

	// Section "Folge-Tickets" of a ticket (QT-1, ADR-0067 §1), in the panel and the full view after
	// "Quellen": the tickets that stem directly from this one, each with key (link to the ticket in the
	// remembered way, like the sub-tasks), title and status; one in the trash says "(im Papierkorb)"
	// and has no link. Only shown while there are follow-ups; "Folge-Ticket anlegen …" in the menu
	// "•••" makes one. Everything comes from the TicketOriginsStore and follows realtime.
	let {
		ticket,
		store,
		hrefOf
	}: {
		ticket: { id: string };
		store: TicketOriginsStore;
		/** Address of another ticket in the remembered way, with the state of the current page. */
		hrefOf: (id: string) => ResolvedPathname;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const followUps = $derived(
		store.available && store.ticketId === ticket.id ? store.followUps : []
	);
</script>

{#if followUps.length > 0}
	<section class="follow-ups" aria-labelledby={headingId} data-ticket-option="followUps">
		<h3 id={headingId}>Folge-Tickets</h3>
		<ul class="list" aria-labelledby={headingId}>
			{#each followUps as entry (entry.link)}
				<li class="item">
					{#if entry.trashed}
						<span class="key">{entry.key}</span>
						<span class="title">{entry.title} <span class="muted">(im Papierkorb)</span></span>
					{:else}
						<a class="key" href={hrefOf(entry.id)} data-ticket-link>{entry.key}</a>
						<span class="title">{entry.title}</span>
					{/if}
					<StatusPill status={entry.status} />
					<span class="visually-hidden">
						Stammt seit {formatBerlinDateTime(entry.created)} aus diesem Ticket.
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.follow-ups {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.list {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
		font-size: var(--font-size-control);
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	a.key {
		color: var(--color-brand-text);
	}

	.title {
		flex: 1 1 10rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.muted {
		color: var(--color-text-muted);
	}
</style>
