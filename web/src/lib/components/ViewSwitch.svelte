<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { findTrashStore } from '$lib/stores/trash.svelte';
	import {
		calendarHref,
		dayPlanHref,
		doneHref,
		doneViewHref,
		inboxHref,
		listHref,
		projectsHref,
		recurrencesHref,
		trashHref
	} from '$lib/ticket-links';

	// Navigation of the views in the section bar (E3 plan, T-3 and package 14; ADR-0010 section 5):
	// one link per view, because each has its own address, in the fixed order of ER-1 (ADR-0066 §1,
	// decision of the user): Aufgaben, Tagesplan, Projekte, Eingang, Wiederholungen, Kalender,
	// Erledigte, Papierkorb. The same order holds in every context of the tab (KOB-1, ADR-0057): no
	// entry depends on the device or the account. On a narrow window the segments wrap in this order
	// (.segmented of base.css); there is no folded variant. The current one carries
	// aria-current="page" and is the thumb of the segmented control (ADR-0029 section 9): weight,
	// frame and shadow besides its colour. A view keeps its state while it is shown: "Aufgaben" the
	// list state of the URL, "Tagesplan" its day (ADR-0065), "Eingang" its chips, "Kalender" its view,
	// date and filters (ADR-0053), "Erledigte" its filters. The number of new inbox entries stands
	// next to "Eingang" (ADR-0015 section 5), that of new tickets in projects next to "Projekte", the
	// number of tickets in the trash next to "Papierkorb" (ADR-0037 §9, since ER-1 a segment like the
	// others instead of a quiet link after them), each as text for screen readers too. In the
	// settings (ADR-0026 section 1) no view is current: current is null, and all links lead to the
	// plain views.
	let {
		current,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		current:
			| 'tasks'
			| 'dayplan'
			| 'projects'
			| 'inbox'
			| 'recurrences'
			| 'calendar'
			| 'done'
			| 'trash'
			| null;
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
	const doneLink = $derived(current === 'done' ? doneViewHref(page.url) : doneHref());
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
		<a href={doneLink} aria-current={current === 'done' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="8" cy="8" r="5.5" />
				<path d="M5.5 8.25l1.75 1.75 3.25-3.5" />
			</svg>
			Erledigte
		</a>
		<a href={trashHref()} aria-current={current === 'trash' ? 'page' : undefined}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9M7 7v4M9 7v4" />
			</svg>
			Papierkorb
			{#if trashCount !== null && trashCount > 0}
				<span class="count quiet"
					><span aria-hidden="true">{trashCount}</span><span class="visually-hidden"
						>({trashCount === 1 ? '1 Ticket' : `${trashCount} Tickets`})</span
					></span
				>
			{/if}
		</a>
	</div>
</nav>

<style>
	/*
	 * Track, entries, thumb, hover, focus and wrapping on narrow windows come from .segmented in
	 * base.css; here only the counts and the icons.
	 */
	.view-switch {
		display: inline-flex;
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

	/* The number of the trash is no call to act: muted, without the colour of "neu". */
	.count.quiet {
		color: var(--color-text-muted);
		background: none;
		border-color: var(--color-line);
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
