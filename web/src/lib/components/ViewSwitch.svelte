<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { listHref, projectsHref } from '$lib/ticket-links';

	// Switch "Aufgaben | Projekte" in the section bar of both views (E3 plan, T-3 and package 14;
	// ADR-0010 section 5): a navigation with two links, because both views have their own
	// address. The current one carries aria-current="page" and is marked by weight and a line
	// besides its colour. "Aufgaben" keeps the list state of the URL while the list is shown and
	// opens the plain list from the project view.
	let { current }: { current: 'tasks' | 'projects' } = $props();

	const tasksHref = $derived(current === 'tasks' ? listHref(page.url) : resolve('/'));
</script>

<nav class="view-switch" aria-label="Ansicht">
	<a href={tasksHref} aria-current={current === 'tasks' ? 'page' : undefined}>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M3 4h10M3 8h10M3 12h6" />
		</svg>
		Aufgaben
	</a>
	<a href={projectsHref()} aria-current={current === 'projects' ? 'page' : undefined}>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M2.5 4.5v7.5h11V6H8L6.5 4.5z" />
		</svg>
		Projekte
	</a>
</nav>

<style>
	.view-switch {
		display: inline-flex;
		overflow: hidden;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	a {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-decoration: none;
		background: var(--color-surface);
		border-bottom: 2px solid transparent;
	}

	a + a {
		border-left: 1px solid var(--color-line);
	}

	a:hover {
		color: var(--color-text);
	}

	a:focus-visible {
		outline-offset: -2px;
	}

	a[aria-current='page'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-bottom-color: var(--color-brand);
	}

	svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
