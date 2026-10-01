<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Project } from '$lib/domain/project';
	import type { ProjectRow } from '$lib/domain/project-view';
	import { rowMenus } from '$lib/overlay/context-menu';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';

	// Project tiles (E3 plan, T-12 and package 14; ADR-0010 section 1; ADR-0025 section 10, package
	// UI-8): a responsive grid in the given order (by name). Each tile is one link that opens the
	// project panel, like a row of the tables, with name, code and "N aktiv · M gesamt" (and "K neu",
	// ADR-0015); the project in the panel is marked with aria-current and a frame in the brand colour
	// (not only colour: also the bar at its start). Archived projects say so in words. While a number
	// is unknown the tile shows "–".
	// Sub projects (ADR-0034, UP-3): a parent with sub projects gets a section of the full width with
	// its tile, a button to fold them (aria-expanded) and an indented grid of their tiles, each with
	// the overline "in Haus". The rows come from the view (the same tree and folding as the list).
	// Every tile has the menu "•••" of the rows of the list in its corner, next to its link (plan
	// aktionsmenues, AM-5; the entries come from the view). A right click on a tile, Shift+F10 and
	// the context menu key on its link open it as in the tables (rowMenus, the tile is a menu row);
	// a click on the tile still opens the panel.
	let {
		rows,
		activeOf,
		totalOf,
		newOf = () => 0,
		hrefOf,
		menuOf,
		activeId = null,
		ontoggle = () => undefined,
		aggregatedOf = () => false
	}: {
		/** Rows of the view in tree order (filtered, sorted and folded). */
		rows: readonly ProjectRow[];
		/** Tickets of the project that are not done (OF-E3-1); null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** New tickets of the project for the signed-in user (ADR-0015 section 5). */
		newOf?: (project: Project) => number;
		/** Address of the project panel. */
		hrefOf: (project: Project) => ResolvedPathname;
		/** The entries of the menu "•••" of a tile, the same as of a row of the list. */
		menuOf: (project: Project) => readonly MenuAction[];
		/** Project shown in the panel. */
		activeId?: string | null;
		/** Folds or unfolds the sub projects of a parent. */
		ontoggle?: (project: Project) => void;
		/** The numbers of the project include its sub projects (ADR-0034, UP-6). */
		aggregatedOf?: (project: Project) => boolean;
	} = $props();

	/** Top-level rows, each with the rows of its sub projects that are shown. */
	const groups = $derived.by(() => {
		const result: { row: ProjectRow; children: ProjectRow[] }[] = [];
		for (const row of rows) {
			const last = result.at(-1);
			if (row.depth === 1 && last !== undefined) last.children.push(row);
			else result.push({ row, children: [] });
		}
		return result;
	});

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}
</script>

{#snippet tile(row: ProjectRow)}
	{@const project = row.project}
	{@const active = activeOf(project)}
	{@const total = totalOf(project)}
	{@const fresh = newOf(project)}
	{@const aggregated = aggregatedOf(project)}
	<a
		class="tile-link"
		class:archived={project.archived}
		class:context={row.context}
		href={hrefOf(project)}
		data-project-id={project.id}
		data-row-link
		aria-current={project.id === activeId ? 'page' : undefined}
	>
		{#if row.depth === 1 && project.parent}
			<span class="overline">in {project.parent.name}</span>
		{/if}
		<span class="head">
			<span class="name">{project.name}</span>
			<span class="code">{project.code}</span>
		</span>
		{#if project.archived}
			<span class="badge">Archiviert</span>
		{/if}
		{#if row.context}
			<span class="visually-hidden">(passt nicht zur Suche, Kontext)</span>
		{/if}
		<span class="stats" title={aggregated ? 'inkl. Unterprojekte' : undefined}>
			<span><strong>{number(active)}</strong> aktiv</span>
			<span aria-hidden="true">·</span>
			<span><strong>{number(total)}</strong> gesamt</span>
			{#if fresh > 0}
				<span aria-hidden="true">·</span>
				<span class="new"><strong>{fresh}</strong> neu</span>
			{/if}
			{#if aggregated}
				<span class="visually-hidden">, inkl. Unterprojekte</span>
			{/if}
		</span>
	</a>
	<!-- Next to the link, never in it (no button inside a link); the corner of the tile. -->
	<span class="tile-menu">
		<ActionsMenu
			label={`Weitere Aktionen für „${project.name}“`}
			buttonLabel={`Weitere Aktionen für „${project.name}“`}
			buttonTitle="Weitere Aktionen"
			buttonClass="button-icon row-menu"
			items={menuOf(project)}
		/>
	</span>
{/snippet}

<ul class="tiles" {@attach rowMenus}>
	{#each groups as group (group.row.project.id)}
		{@const project = group.row.project}
		{#if group.row.childCount > 0}
			{@const count =
				group.row.childCount === 1 ? '1 Unterprojekt' : `${group.row.childCount} Unterprojekte`}
			<li class="family">
				<div class="tile" class:current={project.id === activeId} data-menu-row>
					{@render tile(group.row)}
				</div>
				<!-- The name starts with the visible count; aria-expanded says whether they show. -->
				<button
					class="button-subtle fold"
					type="button"
					aria-expanded={!group.row.collapsed}
					aria-label={`${count} von ${project.name}`}
					onclick={() => ontoggle(project)}
				>
					<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
						<path d={group.row.collapsed ? 'M4.5 3l3 3-3 3' : 'M3 4.5l3 3 3-3'} />
					</svg>
					{count}
				</button>
				{#if group.children.length > 0}
					<ul class="sub-tiles" aria-label={`Unterprojekte von ${project.name}`}>
						{#each group.children as child (child.project.id)}
							<li class="tile" class:current={child.project.id === activeId} data-menu-row>
								{@render tile(child)}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{:else}
			<li class="tile" class:current={project.id === activeId} data-menu-row>
				{@render tile(group.row)}
			</li>
		{/if}
	{/each}
</ul>

<style>
	.tiles,
	.sub-tiles,
	.family {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: 0.75rem;
		list-style: none;
	}

	/* A parent with sub projects takes a whole line: its tile, the button, then its sub projects. */
	.family {
		grid-column: 1 / -1;
		gap: 0.5rem 0.75rem;
	}

	.fold {
		grid-column: 1 / -1;
		justify-self: start;
		font-size: var(--font-size-control);
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

	/* Indented, with a line that ties the sub projects to their parent. */
	.sub-tiles {
		grid-column: 1 / -1;
		padding-left: 1.25rem;
		border-left: 2px solid var(--color-line);
	}

	/* Same surface as the KPI tiles: radius, line and padding (ADR-0025 section 10). */
	.tile {
		position: relative;
		min-width: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* The menu "•••" (AM-5) in the top right corner, at the small height of the rows (base.css). */
	.tile-menu {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
	}

	.tile:hover {
		border-color: var(--color-brand);
	}

	.tile.current {
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	/* Room on the right for the menu, so no text runs below it. */
	.tile-link {
		display: grid;
		gap: 0.5rem;
		height: 100%;
		padding: 0.75rem 2.5rem 0.75rem 1rem;
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-surface);
	}

	/* Second, non-colour mark of the current tile: a bar at its start, like the current row. */
	.current .tile-link {
		position: relative;
	}

	.current .tile-link::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 3px;
		content: '';
		background: var(--color-brand);
		border-radius: var(--radius-surface) 0 0 var(--radius-surface);
	}

	.overline {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.625rem;
		align-items: baseline;
		min-width: 0;
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	.badge {
		justify-self: start;
		padding: 0 0.5rem;
		font-size: var(--font-size-small);
		line-height: 1.25rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.archived .name,
	.context .name {
		color: var(--color-text-muted);
	}

	.stats {
		display: flex;
		gap: 0.375rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.stats strong {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.stats .new,
	.stats .new strong {
		color: var(--color-brand-text);
	}
</style>
