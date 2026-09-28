<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Kpis } from '$lib/domain/kpis';
	import {
		hasFilters,
		parseListQuery,
		resetFilters,
		withFilter,
		type ListQuery
	} from '$lib/domain/list-query';
	import { withListQuery } from '$lib/ticket-links';

	// KPI tiles (E3 plan, T-10 and package 12; ADR-0010 sections 1, 3 and 5): a row of buttons
	// with number and label. The numbers count every ticket that is not done, independent of
	// filters and search. A click sets only the filter group of its tile and leaves the others; a
	// click on the pressed tile sets that group back to "Alle". "Nicht erledigt" resets every
	// filter and the search. Pressed tiles have a check mark and a heavier weight besides their
	// colour; "Überfällig" is not red (ADR-0009).
	let { kpis }: { kpis: Kpis | null } = $props();

	interface Tile {
		key: keyof Kpis;
		label: string;
		/** Spoken label after the number, e.g. "3 überfällig". */
		spoken: string;
		pressed: (query: ListQuery) => boolean;
		/** Query after a click on the tile. */
		next: (query: ListQuery, pressed: boolean) => ListQuery;
	}

	const TILES: readonly Tile[] = [
		{
			key: 'notDone',
			label: 'Nicht erledigt',
			spoken: 'nicht erledigt',
			pressed: (query) => !hasFilters(query),
			next: (query) => resetFilters(query)
		},
		{
			key: 'inProgress',
			label: 'In Arbeit',
			spoken: 'in Arbeit',
			pressed: (query) => query.status === 'in_progress',
			next: (query, pressed) => withFilter(query, 'status', pressed ? null : 'in_progress')
		},
		{
			key: 'dueToday',
			label: 'Heute fällig',
			spoken: 'heute fällig',
			pressed: (query) => query.due === 'today',
			next: (query, pressed) => withFilter(query, 'due', pressed ? null : 'today')
		},
		{
			key: 'overdue',
			label: 'Überfällig',
			spoken: 'überfällig',
			pressed: (query) => query.due === 'overdue',
			next: (query, pressed) => withFilter(query, 'due', pressed ? null : 'overdue')
		},
		{
			key: 'urgent',
			label: 'Dringend',
			spoken: 'dringend',
			pressed: (query) => query.priority === 'urgent',
			next: (query, pressed) => withFilter(query, 'priority', pressed ? null : 'urgent')
		}
	];

	const uid = $props.id();
	const query = $derived(parseListQuery(page.url.searchParams));

	function hint(tile: Tile, pressed: boolean): string {
		if (tile.key === 'notDone') return pressed ? 'Kein Filter gesetzt' : 'Filter zurücksetzen';
		return pressed ? 'Filter entfernen' : 'Filtern';
	}

	async function choose(tile: Tile, pressed: boolean) {
		// "Nicht erledigt" without a filter: nothing to reset, no history entry.
		if (tile.key === 'notDone' && pressed) return;
		await goto(withListQuery(page.url, tile.next(query, pressed)), {
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<div class="kpi-tiles" role="group" aria-label="Kennzahlen">
	{#each TILES as tile (tile.key)}
		{@const pressed = tile.pressed(query)}
		{@const count = kpis?.[tile.key] ?? null}
		{@const hintId = `${uid}-${tile.key}-hint`}
		<button
			class="tile"
			type="button"
			data-kpi={tile.key}
			aria-pressed={pressed ? 'true' : 'false'}
			aria-describedby={hintId}
			onclick={() => choose(tile, pressed)}
		>
			<span class="label" aria-hidden="true">
				{#if pressed}
					<svg class="check" viewBox="0 0 16 16" focusable="false">
						<path d="M3.5 8.5l3 3 6-7" />
					</svg>
				{/if}
				{tile.label}
			</span>
			<span class="value" aria-hidden="true">{count ?? '–'}</span>
			<span class="visually-hidden">
				{count === null ? tile.label : `${count} ${tile.spoken}`}
			</span>
			<!-- Description only (aria-describedby), not part of the name. -->
			<span class="hint" id={hintId} aria-hidden="true">{hint(tile, pressed)}</span>
		</button>
	{/each}
</div>

<style>
	.kpi-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		align-items: flex-start;
		padding: 0.75rem 1rem;
		text-align: left;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
		cursor: pointer;
	}

	.tile:hover {
		border-color: var(--color-brand);
	}

	.tile[aria-pressed='true'] {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.label {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.tile[aria-pressed='true'] .label {
		color: inherit;
	}

	.value {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.tile[aria-pressed='true'] .value {
		font-weight: 700;
	}

	.hint {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.tile[aria-pressed='true'] .hint {
		color: inherit;
	}

	.check {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
