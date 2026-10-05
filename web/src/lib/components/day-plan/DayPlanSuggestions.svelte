<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import KindBadge from '../KindBadge.svelte';
	import DayPlanSettings from './DayPlanSettings.svelte';

	// "Vorschläge" of the plan of today (ADR-0065 §3), a section that folds (the heading is the button,
	// aria-expanded). Each suggestion names its reason ("heute fällig", "überfällig seit 05.10.", …);
	// chosen ones go into the plan with "Übernehmen", all with "Alle übernehmen". What is in the plan is
	// no suggestion any more. The sources are set next to the heading ("Einstellen").
	let {
		store,
		household = false,
		open = $bindable(true)
	}: { store: DayPlanStore; household?: boolean; open?: boolean } = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const listId = `${uid}-list`;
	const links = ticketLinks();
	const chosen = new SvelteSet<string>();

	const rows = $derived(store.suggestions);
	/** Only suggestions that are still there count as chosen. */
	const picked = $derived(
		rows.filter((row) => chosen.has(row.ticket.id)).map((row) => row.ticket.id)
	);
	const busy = $derived(rows.some((row) => store.isPending(row.ticket.id)));

	function toggle(id: string, on: boolean) {
		if (on) chosen.add(id);
		else chosen.delete(id);
	}

	async function adoptChosen() {
		if (picked.length === 0 || busy) return;
		const ids = [...picked];
		if (await store.adopt(ids)) for (const id of ids) chosen.delete(id);
	}

	async function adoptAll() {
		if (rows.length === 0 || busy) return;
		if (await store.adoptAll()) chosen.clear();
	}
</script>

<section class="suggestions" aria-labelledby={headingId} aria-busy={busy ? 'true' : undefined}>
	<div class="head">
		<h3 id={headingId}>
			<button
				class="disclosure"
				type="button"
				aria-expanded={open}
				aria-controls={listId}
				onclick={() => (open = !open)}
			>
				<svg class="chevron" class:open viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M6 4l4 4-4 4" />
				</svg>
				Vorschläge
				<span class="count">
					<span aria-hidden="true">{rows.length}</span>
					<span class="visually-hidden"
						>({rows.length === 1 ? '1 Vorschlag' : `${rows.length} Vorschläge`})</span
					>
				</span>
			</button>
		</h3>
		<DayPlanSettings {store} {household} />
	</div>
	<div id={listId} hidden={!open}>
		{#if rows.length === 0}
			<p class="hint">Keine Vorschläge für heute.</p>
		{:else}
			<ul class="list">
				{#each rows as row (row.ticket.id)}
					{@const ticket = row.ticket}
					<li class="suggestion">
						<label class="choice">
							<input
								type="checkbox"
								checked={chosen.has(ticket.id)}
								onchange={(event) => toggle(ticket.id, event.currentTarget.checked)}
							/>
							<CharmIcon charm={ticket.charm} />
							<span class="key">{ticket.key}</span>
							<span class="title">{ticket.title}</span>
							<KindBadge kind={ticket.kind} />
							<span class="reason">– {row.suggestion.reasons.join(' · ')}</span>
						</label>
						<a
							class="button-icon open"
							href={links.href(ticket.id, page.url)}
							data-ticket-link={ticket.id}
							aria-label={`${ticket.key} öffnen`}
							title="Öffnen"
						>
							<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
								<path d="M6 3.5h6.5V10M12.5 3.5L4 12" />
							</svg>
						</a>
					</li>
				{/each}
			</ul>
			<div class="actions">
				<button
					class="button-primary button-small"
					type="button"
					aria-disabled={picked.length === 0 || busy ? 'true' : undefined}
					aria-busy={busy ? 'true' : undefined}
					onclick={() => void adoptChosen()}
				>
					Übernehmen{picked.length > 0 ? ` (${picked.length})` : ''}
				</button>
				<button
					class="button-secondary button-small"
					type="button"
					aria-disabled={busy ? 'true' : undefined}
					onclick={() => void adoptAll()}
				>
					Alle übernehmen
				</button>
			</div>
		{/if}
	</div>
</section>

<style>
	.suggestions {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.disclosure {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		min-height: var(--control-height-m);
		padding: 0 0.25rem;
		font: inherit;
		color: var(--color-text);
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.disclosure:hover {
		background: var(--fill-control-hover);
	}

	.chevron {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform var(--motion-fast) var(--motion-ease);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.count {
		min-width: 1.25rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.list {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.suggestion {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.choice {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
		min-height: var(--control-height-m);
		cursor: pointer;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.title {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.reason {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.open svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	@media (pointer: coarse) {
		.choice,
		.disclosure,
		.open {
			min-height: var(--control-height-touch);
		}

		.open {
			min-width: var(--control-height-touch);
		}
	}
</style>
