<script lang="ts">
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { CHANNEL_LABELS } from '$lib/domain/inbox';
	import type { Ticket } from '$lib/domain/ticket';
	import { inboxItemHref } from '$lib/ticket-links';

	// Source and dates of a ticket (E2 plan, package 7; E4 plan, package 3), shared by the side
	// panel (both in one line) and the full view (the cards "Quelle" and "Metadaten",
	// ADR-0025 section 7).
	let {
		ticket,
		show = 'all'
	}: {
		ticket: Ticket;
		/** all: source and dates; source: only the source; dates: created, updated, completed. */
		show?: 'all' | 'source' | 'dates';
	} = $props();
</script>

<dl class="meta" class:stacked={show !== 'all'}>
	{#if show !== 'dates' && ticket.source !== null}
		<div>
			<dt>Quelle</dt>
			<dd>
				{CHANNEL_LABELS[ticket.source]}
				{#if ticket.sourceItem !== null}
					· <a href={inboxItemHref(ticket.sourceItem)}>Original ansehen</a>
				{/if}
			</dd>
		</div>
	{/if}
	{#if show !== 'source'}
		<div>
			<dt>Erstellt</dt>
			<dd>{formatBerlinDateTime(ticket.created)}</dd>
		</div>
		<div>
			<dt>Aktualisiert</dt>
			<dd>{formatBerlinDateTime(ticket.updated)}</dd>
		</div>
		{#if ticket.completedAt}
			<div>
				<dt>Erledigt am</dt>
				<dd>{formatBerlinDateTime(ticket.completedAt)}</dd>
			</div>
		{/if}
	{/if}
</dl>

<style>
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		padding-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-line);
	}

	/* In a card of the full view: one line per value, no line above. */
	.stacked {
		display: grid;
		gap: 0.375rem;
		padding-top: 0;
		font-size: 0.8125rem;
		border-top: none;
	}

	.stacked div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	.meta dd {
		min-width: 0;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.meta a {
		color: var(--color-brand-text);
	}
</style>
