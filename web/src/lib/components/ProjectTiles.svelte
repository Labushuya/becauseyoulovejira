<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Project } from '$lib/domain/project';

	// Project tiles (E3 plan, T-12 and package 14; ADR-0010 section 1; ADR-0025 section 10, package
	// UI-8): a responsive grid in the given order (by name). Each tile is one link that opens the
	// project panel, like a row of the tables, with name, code and "N aktiv · M gesamt" (and "K neu",
	// ADR-0015); the project in the panel is marked with aria-current and a frame in the brand colour
	// (not only colour: also the bar at its start). "Tickets anzeigen" stands in the panel. Archived
	// projects say so in words. While a number is unknown the tile shows "–".
	let {
		projects,
		activeOf,
		totalOf,
		newOf = () => 0,
		hrefOf,
		activeId = null
	}: {
		projects: readonly Project[];
		/** Tickets of the project that are not done (OF-E3-1); null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** New tickets of the project for the signed-in user (ADR-0015 section 5). */
		newOf?: (project: Project) => number;
		/** Address of the project panel. */
		hrefOf: (project: Project) => ResolvedPathname;
		/** Project shown in the panel. */
		activeId?: string | null;
	} = $props();

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}
</script>

<ul class="tiles">
	{#each projects as project (project.id)}
		{@const active = activeOf(project)}
		{@const total = totalOf(project)}
		{@const fresh = newOf(project)}
		<li class="tile" class:archived={project.archived} class:current={project.id === activeId}>
			<a
				class="tile-link"
				href={hrefOf(project)}
				data-project-id={project.id}
				aria-current={project.id === activeId ? 'page' : undefined}
			>
				<span class="head">
					<span class="name">{project.name}</span>
					<span class="code">{project.code}</span>
				</span>
				{#if project.archived}
					<span class="badge">Archiviert</span>
				{/if}
				<span class="stats">
					<span><strong>{number(active)}</strong> aktiv</span>
					<span aria-hidden="true">·</span>
					<span><strong>{number(total)}</strong> gesamt</span>
					{#if fresh > 0}
						<span aria-hidden="true">·</span>
						<span class="new"><strong>{fresh}</strong> neu</span>
					{/if}
				</span>
			</a>
		</li>
	{/each}
</ul>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.75rem;
		list-style: none;
	}

	/* Same surface as the KPI tiles: radius, line and padding (ADR-0025 section 10). */
	.tile {
		min-width: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.tile:hover {
		border-color: var(--color-brand);
	}

	.tile.current {
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.tile-link {
		display: grid;
		gap: 0.5rem;
		height: 100%;
		padding: 0.75rem 1rem;
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
		font-size: 0.8125rem;
		color: var(--color-brand-text);
	}

	.badge {
		justify-self: start;
		padding: 0 0.5rem;
		font-size: 0.75rem;
		line-height: 1.25rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.archived .name {
		color: var(--color-text-muted);
	}

	.stats {
		display: flex;
		gap: 0.375rem;
		font-size: 0.8125rem;
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
