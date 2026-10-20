<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import KindBadge from '../KindBadge.svelte';
	import SubtaskNestIcon from '../SubtaskNestIcon.svelte';
	import SubtaskPath from '../SubtaskPath.svelte';
	import SubtaskProgressChip from '../SubtaskProgressChip.svelte';
	import DayPlanSettings from './DayPlanSettings.svelte';

	// "Vorschläge" of the plan of today (ADR-0065 §3), a section that folds (the heading is the button,
	// aria-expanded). Each suggestion names its reason ("heute fällig", "überfällig seit 05.10.", …);
	// chosen ones go into the plan with "Übernehmen", all with "Alle übernehmen", in the order shown.
	// What is in the plan is no suggestion any more. The sources are set next to the heading
	// ("Einstellen"). Arranged like the table "Aufgaben" (TP-3): a suggested sub-task stands indented
	// with the corner directly below its suggested parent, the parent with the chip "2/5"; choosing
	// the parent chooses none of its sub-tasks. A sub-task whose parent is no suggestion names it
	// above its title (TP-2).
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

	const rows = $derived(store.suggestionRows);
	/** Only suggestions that are still there count as chosen. */
	const picked = $derived(
		rows.filter((row) => chosen.has(row.entry.ticket.id)).map((row) => row.entry.ticket.id)
	);
	const busy = $derived(rows.some((row) => store.isPending(row.entry.ticket.id)));

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
				{#each rows as { entry, nested, parent } (entry.ticket.id)}
					{@const ticket = entry.ticket}
					<li class="suggestion" class:nested>
						{#if parent && !nested}
							<!-- A sub-task names its parent above its title (TP-2), outside the label: the
							     link opens the parent and is no part of the name of the check box. -->
							<span class="parent-line">
								<SubtaskPath {parent} withTitle href={links.href(parent.id, page.url)} />
							</span>
						{/if}
						<label class="choice">
							<input
								type="checkbox"
								checked={chosen.has(ticket.id)}
								onchange={(event) => toggle(ticket.id, event.currentTarget.checked)}
							/>
							{#if parent && nested}
								<!-- Indented below its parent (TP-3): the corner; the name of the check box
								     begins with "Unteraufgabe von HAUS-7:". -->
								<SubtaskPath {parent} path={false} />
								<SubtaskNestIcon />
							{/if}
							<CharmIcon charm={ticket.charm} />
							<span class="key">{ticket.key}</span>
							<span class="title">{ticket.title}</span>
							<KindBadge kind={ticket.kind} />
							<SubtaskProgressChip progress={store.progressOf(ticket.id)} />
							<span class="reason">– {entry.suggestion.reasons.join(' · ')}</span>
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

	/* One column never wider than the section, also with indented rows (TP-3). */
	.list {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.suggestion {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		align-items: center;
		min-width: 0;
	}

	/* A sub-task below its suggested parent (TP-3): the whole row indented, like in the pool. */
	.suggestion.nested {
		padding-left: 1.5rem;
	}

	/* The parent of a sub-task: a line of its own, in line with the title after the check box (1rem
	   in base.css) and the gap of the choice. */
	.parent-line {
		display: flex;
		flex: 1 1 100%;
		min-width: 0;
		padding-left: 1.5rem;
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

	/*
	 * Phone frame (MO-2, ADR-0073 addendum MO-2): the heading that folds is a target of 44 px; the
	 * choices, "Öffnen" and the buttons have theirs from base.css. The view puts the section after the
	 * plan, folded.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .disclosure {
			min-height: var(--control-height-touch);
		}

		/* Turned, the chevron carries the class "open", which the rule of touch screens above gives
		   44 px for "Öffnen"; it keeps its own size. */
		:global(:root[data-mobile-layout='on']) .chevron {
			min-width: 0;
			min-height: 0;
		}
	}
</style>
