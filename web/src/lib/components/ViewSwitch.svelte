<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { inboxHref, listHref, projectsHref } from '$lib/ticket-links';

	// Switch "Aufgaben | Projekte | Eingang" in the section bar of the views (E3 plan, T-3 and
	// package 14; E4 plan, package 3; ADR-0010 section 5): a navigation with one link per view,
	// because each has its own address. The current one carries aria-current="page" and is marked
	// by weight and a line besides its colour. "Aufgaben" keeps the list state of the URL while the
	// list is shown, "Eingang" its chips while the inbox is shown. The number of new inbox entries
	// stands next to "Eingang" (ADR-0015 section 5), as text for screen readers too. In the settings
	// (ADR-0026 section 1) no view is current: current is null, and all links lead to the plain views.
	let {
		current,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		current: 'tasks' | 'projects' | 'inbox' | null;
		/** New inbox entries; null while not loaded (no number is shown). */
		inboxCount?: number | null;
		/** New tickets in projects (ADR-0015 section 5); 0 shows no number. */
		projectsNewCount?: number;
	} = $props();

	const tasksHref = $derived(current === 'tasks' ? listHref(page.url) : resolve('/'));
	const inboxLink = $derived(current === 'inbox' ? inboxHref(page.url) : inboxHref());
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
		{#if projectsNewCount > 0}
			<span class="count"
				><span aria-hidden="true">{projectsNewCount}</span><span class="visually-hidden"
					>({projectsNewCount} neu)</span
				></span
			>
		{/if}
	</a>
	<a href={inboxLink} aria-current={current === 'inbox' ? 'page' : undefined}>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M2.5 9.5l1.75-6h7.5l1.75 6v3.5h-11zM2.5 9.5h3l1 1.5h3l1-1.5h3" />
		</svg>
		Eingang
		{#if inboxCount !== null && inboxCount > 0}
			<span class="count"
				><span aria-hidden="true">{inboxCount}</span><span class="visually-hidden"
					>({inboxCount} neu)</span
				></span
			>
		{/if}
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

	.count {
		min-width: 1.25rem;
		padding: 0 0.3125rem;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: 0.5625rem;
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
