<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { findTrashStore } from '$lib/stores/trash.svelte';
	import {
		calendarHref,
		dayPlanHref,
		inboxHref,
		listHref,
		projectsHref,
		recurrencesHref,
		trashHref
	} from '$lib/ticket-links';

	// Switch "Aufgaben | Projekte | Eingang | Wiederholungen" in the section bar of the views (E3
	// plan, T-3 and package 14; E4 plan, package 3; E5 plan, T-6 and package 5; ADR-0010 section
	// 5): a navigation with one link per view,
	// because each has its own address. The current one carries aria-current="page" and is marked
	// as the thumb of the segmented control of base.css (ADR-0029 section 9): weight, frame and
	// shadow besides its colour. "Aufgaben" keeps the list state of the URL while the
	// list is shown, "Eingang" its chips while the inbox is shown. The number of new inbox entries
	// stands next to "Eingang" (ADR-0015 section 5), as text for screen readers too. In the settings
	// (ADR-0026 section 1) no view is current: current is null, and all links lead to the plain views.
	// After the segments stands the quiet link "Papierkorb" (ADR-0037 §9) with the number of tickets
	// in it, from the store of the (app) layout; it is no segment, so it does not compete with the
	// views. "Kalender" (ADR-0053) comes last among the views and keeps its view, date and filters
	// while the calendar is shown. "Tagesplan" (ADR-0065) stands right after "Aufgaben", the place used
	// most, and keeps its day while the plan is shown.
	let {
		current,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		current:
			'tasks' | 'dayplan' | 'projects' | 'inbox' | 'recurrences' | 'calendar' | 'trash' | null;
		/** New inbox entries; null while not loaded (no number is shown). */
		inboxCount?: number | null;
		/** New tickets in projects (ADR-0015 section 5); 0 shows no number. */
		projectsNewCount?: number;
	} = $props();

	const trash = findTrashStore();
	const trashCount = $derived(trash?.count ?? null);
	const tasksHref = $derived(current === 'tasks' ? listHref(page.url) : resolve('/'));
	const inboxLink = $derived(current === 'inbox' ? inboxHref(page.url) : inboxHref());
	const calendarLink = $derived(current === 'calendar' ? calendarHref(page.url) : calendarHref());
	const dayPlanLink = $derived(current === 'dayplan' ? dayPlanHref(page.url) : dayPlanHref());
</script>

<nav class="view-switch" aria-label="Ansicht">
	<div class="segmented">
		<a href={tasksHref} aria-current={current === 'tasks' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M3 4h10M3 8h10M3 12h6" />
			</svg>
			Aufgaben
		</a>
		<a href={dayPlanLink} aria-current={current === 'dayplan' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M3 3.5h10v10H3zM3 6.5h10M5.5 9.25l1.5 1.5 3-3" />
			</svg>
			Tagesplan
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
		<a href={inboxLink} aria-current={current === 'inbox' ? 'page' : undefined} data-tour="inbox">
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
		<a href={recurrencesHref()} aria-current={current === 'recurrences' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1" />
				<path d="M3.25 1.75v3h3M12.75 14.25v-3h-3" />
			</svg>
			Wiederholungen
		</a>
		<a href={calendarLink} aria-current={current === 'calendar' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M2.5 4.5h11v9h-11zM2.5 7.5h11M5.5 2.5v3M10.5 2.5v3" />
			</svg>
			Kalender
		</a>
	</div>
	<a
		class="trash-link"
		class:current={current === 'trash'}
		href={trashHref()}
		aria-current={current === 'trash' ? 'page' : undefined}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9M7 7v4M9 7v4" />
		</svg>
		Papierkorb
		{#if trashCount !== null && trashCount > 0}
			<span class="trash-count"
				><span aria-hidden="true">{trashCount}</span><span class="visually-hidden"
					>({trashCount === 1 ? '1 Ticket' : `${trashCount} Tickets`})</span
				></span
			>
		{/if}
	</a>
</nav>

<style>
	/*
	 * Track, entries, thumb, hover, focus and wrapping on narrow windows come from .segmented in
	 * base.css; here only the counts, the icons and the quiet link "Papierkorb".
	 */
	.view-switch {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		max-width: 100%;
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
		border-radius: var(--radius-pill);
	}

	/* Quiet: muted text without a track; current as text weight and colour, not as a thumb. */
	.trash-link {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		min-height: var(--control-height-m);
		padding: 0 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		text-decoration: none;
		border-radius: var(--radius-control);
	}

	.trash-link:hover {
		color: var(--color-text);
		background: var(--fill-control-hover);
	}

	.trash-link.current {
		font-weight: 600;
		color: var(--color-brand-text);
	}

	.trash-count {
		min-width: 1.25rem;
		padding: 0 0.3125rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
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
