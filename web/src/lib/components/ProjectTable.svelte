<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import type { Project } from '$lib/domain/project';
	import {
		PROJECT_COLUMN_LABELS,
		projectSortDirection,
		projectSortOrderLabel,
		type ProjectSort,
		type ProjectSortKey
	} from '$lib/domain/project-view';

	// Project list (user request after EH-4), the default layout of the project view: a table like
	// the ones of "Aufgaben" and "Eingang" with Code (mono), Name (link to the project panel, like
	// the title of a ticket), "aktiv", "gesamt", "neu" and "archiviert". Sort buttons sit in the
	// column headers; the view keeps the sort in the URL. The row of the project in the panel is
	// marked (colour plus a bar at its start, aria-current on the link). The table never scrolls
	// sideways (package UI-6b): in a narrow frame container queries hide columns in a fixed order,
	// first "archiviert", then "neu", then "gesamt", last "aktiv"; code and name always stay, and
	// the caption then names the panel, where the numbers stand.
	let {
		projects,
		activeOf,
		totalOf,
		newOf,
		hrefOf,
		activeId = null,
		sort = null,
		searching = false,
		onsort
	}: {
		/** Projects in the order to show (filtered and sorted by the view). */
		projects: readonly Project[];
		/** Tickets of the project that are not done; null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** New tickets of the project for the signed-in user (ADR-0015 section 5). */
		newOf: (project: Project) => number;
		/** Address of the project panel. */
		hrefOf: (project: Project) => ResolvedPathname;
		/** Project shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** Column sort of the URL; null: by name. */
		sort?: ProjectSort | null;
		/** A search narrows the list; the caption says so. */
		searching?: boolean;
		/** Click on a column header; the view navigates. */
		onsort: (key: ProjectSortKey) => void;
	} = $props();

	const caption = $derived(
		`Projekte · ${
			sort === null
				? 'nach Name'
				: `sortiert nach ${PROJECT_COLUMN_LABELS[sort.key]}, ${projectSortOrderLabel(sort)}`
		}${searching ? ' · gefiltert nach Suche' : ''}`
	);

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}
</script>

{#snippet sortable(key: ProjectSortKey, text: string, className = '', column?: string)}
	{@const sorted = sort?.key === key ? sort : null}
	{@const direction = sorted === null ? null : projectSortDirection(sorted)}
	<th scope="col" class={className} aria-sort={direction ?? undefined} data-col={column}>
		<button class="sort" class:sorted={sorted !== null} type="button" onclick={() => onsort(key)}>
			<span aria-hidden="true">{text}</span>
			<span class="visually-hidden">
				Nach {PROJECT_COLUMN_LABELS[key]} sortieren{sorted === null
					? ''
					: `, sortiert: ${projectSortOrderLabel(sorted)}`}
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

<div class="frame">
	<table>
		<caption>{caption}<span class="caption-more">{MORE_COLUMNS_HINT}</span></caption>
		<thead>
			<tr>
				{@render sortable('code', 'Code', 'code-col')}
				{@render sortable('name', 'Name', 'name-col')}
				{@render sortable('active', 'aktiv', 'number-col', 'active')}
				{@render sortable('total', 'gesamt', 'number-col', 'total')}
				{@render sortable('new', 'neu', 'number-col', 'new')}
				{@render sortable('archived', 'archiviert', '', 'archived')}
			</tr>
		</thead>
		<tbody>
			{#each projects as project (project.id)}
				{@const fresh = newOf(project)}
				<tr
					class="row"
					class:active={project.id === activeId}
					class:archived={project.archived}
					data-project-row={project.id}
				>
					<td class="code">{project.code}</td>
					<th class="name" scope="row">
						<a
							class="title-link"
							href={hrefOf(project)}
							data-project-id={project.id}
							aria-current={project.id === activeId ? 'page' : undefined}>{project.name}</a
						>
					</th>
					<td class="number" data-col="active">{number(activeOf(project))}</td>
					<td class="number" data-col="total">{number(totalOf(project))}</td>
					<td class="number" class:fresh={fresh > 0} data-col="new">{fresh}</td>
					<td class="state" data-col="archived">
						{#if project.archived}
							Archiviert
						{:else}
							<span aria-hidden="true">–</span><span class="visually-hidden">nein</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* Container of the column rules; the table takes its width and never more. */
	.frame {
		container-type: inline-size;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	table {
		width: 100%;
		font-size: 0.875rem;
		border-collapse: collapse;
	}

	.caption-more {
		display: none;
		font-weight: 400;
	}

	/* Columns that give way, in this order: archiviert, neu, gesamt, aktiv. */
	@container (max-width: 40rem) {
		.caption-more {
			display: inline;
		}
	}

	@container (max-width: 40rem) {
		.frame :global([data-col='archived']) {
			display: none;
		}
	}

	@container (max-width: 34rem) {
		.frame :global([data-col='new']) {
			display: none;
		}
	}

	@container (max-width: 28rem) {
		.frame :global([data-col='total']) {
			display: none;
		}
	}

	@container (max-width: 22rem) {
		.frame :global([data-col='active']) {
			display: none;
		}
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
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

	.name-col {
		width: 100%;
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

	.row {
		border-bottom: 1px solid var(--color-line);
	}

	.row:last-child {
		border-bottom: none;
	}

	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the open row: a bar at its start. */
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	td,
	.name {
		padding: 0.375rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	.code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		white-space: nowrap;
		color: var(--color-brand-text);
	}

	.name {
		font-weight: 400;
	}

	.title-link {
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.archived .title-link,
	.state {
		color: var(--color-text-muted);
	}

	.number,
	.state {
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.number {
		font-variant-numeric: tabular-nums;
	}

	.number.fresh {
		font-weight: 600;
		color: var(--color-brand-text);
	}
</style>
