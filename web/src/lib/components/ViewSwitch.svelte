<script lang="ts">
	import { page } from '$app/state';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { findTrashStore } from '$lib/stores/trash.svelte';
	import { viewHref } from '$lib/views';
	import ViewIcon from './ViewIcon.svelte';

	// Navigation of the views in the section bar (E3 plan, T-3 and package 14; ADR-0010 section 5):
	// one link per view, because each has its own address, in the fixed order of ER-1 (ADR-0066 §1,
	// decision of the user): Aufgaben, Tagesplan, Projekte, Eingang, Wiederholungen, Kalender,
	// Erledigte, Papierkorb. The same order holds in every context of the tab (KOB-1, ADR-0057): no
	// entry depends on the device or the account. On a narrow window the segments wrap in this order
	// (.segmented of base.css); there is no folded variant. In the phone frame (choice "Handy-Ansicht:
	// Automatisch" and below 40rem, MO-1a, ADR-0073 and addendum to ADR-0066 §1) the bottom bar and
	// "Mehr" take its place with the same views, names and links (lib/views.ts), so it is not shown
	// there. The current one carries aria-current="page" and is the thumb of the segmented control
	// (ADR-0029 section 9): weight, frame and shadow besides its colour. A view keeps its state while
	// it is shown: "Aufgaben" the list state of the URL, "Tagesplan" its day (ADR-0065), "Eingang" its
	// chips, "Kalender" its view, date and filters (ADR-0053), "Erledigte" its filters. The number of
	// new inbox entries stands next to "Eingang" (ADR-0015 section 5), that of new tickets in projects
	// next to "Projekte", the number of tickets in the trash next to "Papierkorb" (ADR-0037 §9, since
	// ER-1 a segment like the others instead of a quiet link after them), each as text for screen
	// readers too. In the settings (ADR-0026 section 1) no view is current: current is null, and all
	// links lead to the plain views.
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
	const phone = getMobileLayoutStore();
</script>

{#if !phone.active}
	<nav class="view-switch" aria-label="Ansicht">
		<div class="segmented">
			<a
				href={viewHref('tasks', current, page.url)}
				aria-current={current === 'tasks' ? 'page' : undefined}
			>
				<ViewIcon view="tasks" />
				Aufgaben
			</a>
			<a
				href={viewHref('dayplan', current, page.url)}
				aria-current={current === 'dayplan' ? 'page' : undefined}
			>
				<ViewIcon view="dayplan" />
				Tagesplan
			</a>
			<a
				href={viewHref('projects', current, page.url)}
				aria-current={current === 'projects' ? 'page' : undefined}
			>
				<ViewIcon view="projects" />
				Projekte
				{#if projectsNewCount > 0}
					<span class="count"
						><span aria-hidden="true">{projectsNewCount}</span><span class="visually-hidden"
							>({projectsNewCount} neu)</span
						></span
					>
				{/if}
			</a>
			<a
				href={viewHref('inbox', current, page.url)}
				aria-current={current === 'inbox' ? 'page' : undefined}
				data-tour="inbox"
			>
				<ViewIcon view="inbox" />
				Eingang
				{#if inboxCount !== null && inboxCount > 0}
					<span class="count"
						><span aria-hidden="true">{inboxCount}</span><span class="visually-hidden"
							>({inboxCount} neu)</span
						></span
					>
				{/if}
			</a>
			<a
				href={viewHref('recurrences', current, page.url)}
				aria-current={current === 'recurrences' ? 'page' : undefined}
			>
				<ViewIcon view="recurrences" />
				Wiederholungen
			</a>
			<a
				href={viewHref('calendar', current, page.url)}
				aria-current={current === 'calendar' ? 'page' : undefined}
			>
				<ViewIcon view="calendar" />
				Kalender
			</a>
			<a
				href={viewHref('done', current, page.url)}
				aria-current={current === 'done' ? 'page' : undefined}
			>
				<ViewIcon view="done" />
				Erledigte
			</a>
			<a
				href={viewHref('trash', current, page.url)}
				aria-current={current === 'trash' ? 'page' : undefined}
			>
				<ViewIcon view="trash" />
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
{/if}

<style>
	/*
	 * Track, entries, thumb, hover, focus and wrapping on narrow windows come from .segmented in
	 * base.css; here only the counts. The icons are ViewIcon.
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
</style>
