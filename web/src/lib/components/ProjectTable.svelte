<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import type { Project } from '$lib/domain/project';
	import {
		PROJECT_COLUMN_LABELS,
		projectSortDirection,
		projectSortOrderLabel,
		type ProjectRow,
		type ProjectSort,
		type ProjectSortKey
	} from '$lib/domain/project-view';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';

	// Project list (user request after EH-4), the default layout of the project view: a table like
	// the ones of "Aufgaben" and "Eingang" with Code (mono), Name (link to the project panel, like
	// the title of a ticket), "aktiv", "gesamt", "neu" and "archiviert". Sort buttons sit in the
	// column headers; the view keeps the sort in the URL. The row of the project in the panel is
	// marked (colour plus a bar at its start, aria-current on the link). The table never scrolls
	// sideways (package UI-6b): fitColumns (ADR-0030, package SP-5) fits the columns into the
	// measured frame; in a narrow frame columns give way in a fixed order, first "archiviert", then
	// "neu", then "gesamt", last "aktiv"; code and name always stay, and the caption then names the
	// panel, where the numbers stand. The view shares the column state with its menu "Spalten".
	// Sub projects (ADR-0034, UP-3): the rows come as a tree ("Tabelle mit aufklappbaren Zeilen", no
	// treegrid). A parent carries a disclosure button "Unterprojekte von Haus" (name fixed,
	// aria-expanded says the state) in the name cell;
	// a sub project is indented inside the name cell, so the columns and their widths stay as
	// ADR-0030 says, and it says "Unterprojekt von Haus," to screen readers. A parent that only
	// stands as context of a search match is dimmed and says so.
	let {
		rows,
		activeOf,
		totalOf,
		newOf,
		hrefOf,
		activeId = null,
		sort = null,
		searching = false,
		columnFit = new ColumnFit(getColumnPrefs('projects')),
		onsort,
		ontoggle = () => undefined
	}: {
		/** Rows in the order to show (filtered, sorted and folded by the view). */
		rows: readonly ProjectRow[];
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
		/** Column state (ADR-0030), shared with the menu "Spalten" of the view. */
		columnFit?: ColumnFit;
		/** Click on a column header; the view navigates. */
		onsort: (key: ProjectSortKey) => void;
		/** Folds or unfolds the sub projects of a parent. */
		ontoggle?: (project: Project) => void;
	} = $props();

	const shown = $derived(columnFit.shown);
	let frame = $state<HTMLElement>();

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

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

<div class="frame" bind:this={frame}>
	<table>
		<caption
			>{caption}{#if columnFit.fit.autoHidden.length > 0}<span class="caption-more"
					>{MORE_COLUMNS_HINT}</span
				>{/if}</caption
		>
		<colgroup>
			{#each columnFit.shownColumns as column (column.id)}
				<col
					data-column={column.id}
					style:width={column.flexible ? undefined : `${columnFit.widthOf(column.id)}px`}
				/>
			{/each}
		</colgroup>
		<thead>
			<tr>
				<!-- Every column sorts; its ID is the sort key (T-5). -->
				{#each columnFit.shownColumns as column (column.id)}
					{@const key = column.id as ProjectSortKey}
					{@const sorted = sort?.key === key ? sort : null}
					{@const direction = sorted === null ? null : projectSortDirection(sorted)}
					<ResizableHeader {column} fit={columnFit} ariaSort={direction ?? undefined}>
						<button
							class="sort"
							class:sorted={sorted !== null}
							type="button"
							onclick={() => onsort(key)}
						>
							<span aria-hidden="true">{column.label}</span>
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
					</ResizableHeader>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.project.id)}
				{@const project = row.project}
				{@const fresh = newOf(project)}
				<tr
					class="row"
					class:active={project.id === activeId}
					class:archived={project.archived}
					class:context={row.context}
					class:child={row.depth === 1}
					data-project-row={project.id}
				>
					<td class="code" data-col="code">{project.code}</td>
					<th class="name" scope="row" data-col="name">
						<span class="name-cell">
							{#if row.childCount > 0}
								<button
									class="button-icon fold"
									type="button"
									aria-expanded={!row.collapsed}
									aria-label={`Unterprojekte von ${project.name}`}
									title={row.collapsed ? 'Unterprojekte einblenden' : 'Unterprojekte ausblenden'}
									onclick={() => ontoggle(project)}
								>
									<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
										<path d={row.collapsed ? 'M4.5 3l3 3-3 3' : 'M3 4.5l3 3 3-3'} />
									</svg>
								</button>
							{/if}
							{#if row.depth === 1 && project.parent}
								<span class="visually-hidden">Unterprojekt von {project.parent.name},</span>
							{/if}
							<a
								class="title-link"
								href={hrefOf(project)}
								data-project-id={project.id}
								aria-current={project.id === activeId ? 'page' : undefined}>{project.name}</a
							>
							{#if row.context}
								<span class="visually-hidden">(passt nicht zur Suche, Kontext)</span>
							{/if}
						</span>
					</th>
					{#if shown.has('active')}
						<td class="number" data-col="active">{number(activeOf(project))}</td>
					{/if}
					{#if shown.has('total')}
						<td class="number" data-col="total">{number(totalOf(project))}</td>
					{/if}
					{#if shown.has('new')}
						<td class="number" class:fresh={fresh > 0} data-col="new">{fresh}</td>
					{/if}
					{#if shown.has('archived')}
						<td class="state" data-col="archived">
							{#if project.archived}
								Archiviert
							{:else}
								<span aria-hidden="true">–</span><span class="visually-hidden">nein</span>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* The measured frame of fitColumns (ADR-0030); the table takes its width and never more. */
	.frame {
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* Fixed layout: the widths come from the colgroup, the name takes the rest. */
	table {
		width: 100%;
		table-layout: fixed;
		font-size: var(--font-size-body);
		border-collapse: collapse;
	}

	.caption-more {
		font-weight: 400;
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	thead :global(th) {
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.sort {
		display: inline-flex;
		max-width: 100%;
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

	/* Fixed widths: what does not fit is cut off inside its cell, never beside it. */
	td,
	.name {
		padding: 0.375rem 0.75rem;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		vertical-align: top;
	}

	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		white-space: nowrap;
		color: var(--color-brand-text);
	}

	.name {
		font-weight: 400;
	}

	/* The tree lives inside the name cell (ADR-0034): button, indentation and link. */
	.name-cell {
		display: flex;
		gap: 0.25rem;
		align-items: flex-start;
		min-width: 0;
	}

	.child .name-cell {
		padding-left: 1.75rem;
	}

	/* A smaller icon button than the default, so the row keeps its height. */
	.fold {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		margin: -0.125rem 0;
	}

	.fold svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.title-link {
		min-width: 0;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.archived .title-link,
	.context .title-link,
	.state {
		color: var(--color-text-muted);
	}

	.number,
	.state {
		font-size: var(--font-size-control);
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
