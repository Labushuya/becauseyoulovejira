<script lang="ts">
	import type { Project } from '$lib/domain/project';
	import { projectTicketsHref } from '$lib/ticket-links';

	// Project tiles (E3 plan, T-12 and package 14; ADR-0010 section 1): a responsive grid in the
	// given order (by name). Each tile is a link to the tickets of the project (`/?projekt=<id>`)
	// with name, code and "N aktiv · M gesamt"; "Bearbeiten" sits next to the link, not in it.
	// Archived projects say so in words. While a number is unknown the tile shows "–".
	let {
		projects,
		activeOf,
		totalOf,
		onedit
	}: {
		projects: readonly Project[];
		/** Tickets of the project that are not done (OF-E3-1); null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** "Bearbeiten"; the button is passed along to return the focus to it. */
		onedit: (project: Project, trigger: HTMLButtonElement) => void;
	} = $props();

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}
</script>

<ul class="tiles">
	{#each projects as project (project.id)}
		{@const active = activeOf(project)}
		{@const total = totalOf(project)}
		<li class="tile" class:archived={project.archived}>
			<a class="tile-link" href={projectTicketsHref(project.id)}>
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
				</span>
			</a>
			<button
				class="edit"
				type="button"
				title="Bearbeiten"
				onclick={(event) => onedit(project, event.currentTarget)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
				</svg>
				<span class="visually-hidden">Projekt {project.name} bearbeiten</span>
			</button>
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

	.tile {
		position: relative;
		min-width: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.tile:hover {
		border-color: var(--color-brand);
	}

	.tile-link {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 2.75rem 0.875rem 1rem;
		color: var(--color-text);
		text-decoration: none;
		border-radius: 0.5rem;
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
		border-radius: 0.625rem;
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

	.edit {
		position: absolute;
		top: 0.625rem;
		right: 0.625rem;
		display: inline-flex;
		padding: 0.25rem;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.edit:hover {
		color: var(--color-text);
		border-color: var(--color-line);
	}

	.edit svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
</style>
