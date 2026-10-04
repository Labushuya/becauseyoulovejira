<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		CALENDAR_VIEWS,
		CALENDAR_VIEW_LABELS,
		PERIOD_STEP_LABELS,
		effectiveView,
		entriesByDay,
		entryCountText,
		inPeriod,
		overdueEntries,
		parseCalendarQuery,
		periodOf,
		periodTitle,
		shiftPeriod,
		showsDone,
		type CalendarEntry,
		type CalendarFilter,
		type CalendarLayer,
		type CalendarView as View
	} from '$lib/domain/calendar';
	import { plannedOccurrences } from '$lib/domain/calendar-plan';
	import { parseListQuery } from '$lib/domain/list-query';
	import type { CalendarDoneStore } from '$lib/stores/calendar.svelte';
	import type { CalendarPrefsStore } from '$lib/stores/calendar-prefs.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { InboxStore } from '$lib/stores/inbox.svelte';
	import { findTicketOpenMode } from '$lib/stores/open-mode.svelte';
	import type { RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import { helpHref } from '$lib/settings-sections';
	import { CALENDAR_HOST } from '$lib/ticket-host';
	import {
		calendarFullViewHref,
		calendarItemHref,
		calendarRuleHref,
		calendarTicketHref,
		withCalendarQuery
	} from '$lib/ticket-links';
	import ErrorIcon from '../ErrorIcon.svelte';
	import FilterBar from '../FilterBar.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import SectionBar from '../SectionBar.svelte';
	import ViewSwitch from '../ViewSwitch.svelte';
	import CalendarAgenda from './CalendarAgenda.svelte';
	import CalendarEntryItem, { type EntryPlace } from './CalendarEntry.svelte';
	import CalendarGrid from './CalendarGrid.svelte';
	import CalendarLayers from './CalendarLayers.svelte';

	// View "Kalender" (ADR-0053, plan kalender, K-1): what is due when, as a month, a week or an
	// agenda. View and day stand in the URL (`ansicht`, `datum`) next to the filters of "Aufgaben"
	// (the same parameters and filter bar, without "Fällig" and the search); the last chosen view and
	// the layers stay on this device. Entries come from the stores of the app: the open tickets of
	// the list store (live), the done ones of the period from the CalendarDoneStore (only while shown),
	// the planned dates of the rules computed from the rule store for the period, the dated entries
	// from the new entries of the inbox store. Only the period is computed and rendered. "Heute",
	// before and after change the day of the URL (with a history entry, like the filters), the view
	// switch the view and what this device remembers. A ticket opens next to the calendar in the
	// remembered way (TicketHost); closing its panel returns the focus to its entry. In month and week
	// an open ticket moves to another day (K-2, ADR-0053 §12): the grid asks, the list store saves
	// with `expected_updated` and shows the flag with "Rückgängig". A planned date opens its rule and
	// a date of the inbox its entry next to the calendar too (ADR-0054 §8), marked like a ticket, and
	// closing those panels returns the focus to their entry.
	let {
		tickets,
		catalog,
		rules,
		inbox,
		done,
		prefs,
		rowActions = null,
		duplicates = false,
		activeId = null,
		activeRuleId = null,
		activeItemId = null,
		inboxCount = null
	}: {
		tickets: TicketListStore;
		catalog: CatalogStore;
		rules: RecurrenceStore;
		inbox: InboxStore;
		done: CalendarDoneStore;
		prefs: CalendarPrefsStore;
		/** The menu "•••" of every ticket (plan aktionsmenues); without it the entries have none. */
		rowActions?: TicketRowActionsStore | null;
		/** "Duplizieren …" in that menu (ADR-0045). */
		duplicates?: boolean;
		/** Ticket shown in the panel next to the calendar. */
		activeId?: string | null;
		/** Rule shown in the panel next to the calendar (ADR-0054 §8). */
		activeRuleId?: string | null;
		/** Inbox entry shown in the panel next to the calendar (ADR-0054 §8). */
		activeItemId?: string | null;
		/** New inbox entries for the switch. */
		inboxCount?: number | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const titleId = `${uid}-title`;
	const openMode = findTicketOpenMode();

	/** A ticket next to the calendar in the remembered way (ADR-0036 §1): panel or full view. */
	function ticketHref(ticketId: string) {
		return openMode?.effective === 'full'
			? calendarFullViewHref(ticketId, page.url)
			: calendarTicketHref(ticketId, page.url);
	}

	const query = $derived(parseListQuery(page.url.searchParams));
	const named = $derived(parseCalendarQuery(page.url.searchParams));
	const today = $derived(tickets.today);
	const view = $derived(effectiveView(named.view, prefs.view, prefs.narrow));
	const period = $derived(periodOf(view, named.date ?? today));
	const filter = $derived<CalendarFilter>({
		query,
		layers: prefs.layers,
		today,
		subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id)
	});
	/** Tickets the planned dates must not repeat: the open ones and the loaded done ones. */
	const known = $derived([...tickets.open, ...done.done]);
	const planned = $derived(
		prefs.layers.has('planned')
			? plannedOccurrences(rules.rules, known, today, period.from, period.to)
			: []
	);
	const days = $derived(
		entriesByDay(
			period,
			{ open: tickets.open, done: done.done, planned, inbox: inbox.newItems },
			filter
		)
	);
	/** The group "Überfällig" of the agenda, while its period holds today. */
	const withOverdue = $derived(view === 'agenda' && inPeriod(period, today));
	const overdue = $derived(withOverdue ? overdueEntries(tickets.open, filter, period.from) : []);
	const total = $derived([...days.values()].reduce((sum, list) => sum + list.length, 0));
	const [previousLabel, nextLabel] = $derived(PERIOD_STEP_LABELS[view]);

	// Done tickets only while they are shown, only for the period (ADR-0053 §5).
	$effect(() => {
		const range = showsDone(filter) ? { from: period.from, to: period.to } : null;
		untrack(() => done.follow(range));
	});

	async function navigate(next: { view?: View; date?: CalendarDate | null }) {
		const current = parseCalendarQuery(page.url.searchParams);
		await goto(
			withCalendarQuery(page.url, {
				view: next.view ?? current.view,
				date: next.date === undefined ? current.date : next.date
			}),
			{ keepFocus: true, noScroll: true }
		);
	}

	/** A view of the switch: shown and remembered on this device; the day stays. */
	function chooseView(next: View) {
		prefs.chooseView(next);
		void navigate({ view: next });
	}

	/** "Heute": the period around today, without a day in the URL. */
	function toToday() {
		void navigate({ date: null });
	}

	function step(direction: -1 | 1) {
		void navigate({ date: shiftPeriod(view, period.anchor, direction) });
	}

	function setLayer(layer: CalendarLayer, shown: boolean) {
		prefs.setLayer(layer, shown);
	}

	let heading = $state<HTMLElement>();

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	/** What the panel shows: a ticket, a rule or an entry (ADR-0054 §8), as "kind:id". */
	const shownKey = $derived(
		activeId !== null
			? `ticket:${activeId}`
			: activeRuleId !== null
				? `rule:${activeRuleId}`
				: activeItemId !== null
					? `item:${activeItemId}`
					: null
	);
	/** The panel shown last. */
	let lastShown: string | null = null;

	/** The entry of what a panel showed: a ticket, the first date of a rule, a date of an entry. */
	function entryOfShown(key: string): HTMLElement | null {
		const [kind, id = ''] = key.split(':');
		if (kind === 'ticket') return CALENDAR_HOST.entryOf(id);
		const attribute = kind === 'rule' ? 'data-calendar-rule' : 'data-calendar-item';
		return (
			[...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
				(entry) => entry.getAttribute(attribute) === id
			) ?? null
		);
	}

	// Closing the panel (×, Escape, browser back) returns the focus to the entry of its ticket, or to
	// the heading if the entry is gone (like the rows of "Aufgaben"). A rule or an entry gives it back
	// only when no other panel follows (a ticket it opened takes the focus itself).
	$effect(() => {
		const previous = lastShown;
		const current = shownKey;
		lastShown = current;
		if (previous === null || previous === current) return;
		if (!previous.startsWith('ticket:') && current !== null) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(entryOfShown(previous) ?? heading)?.focus();
		});
	});
</script>

{#snippet entryItem(entry: CalendarEntry, place: EntryPlace)}
	{@const pending = entry.kind === 'ticket' && tickets.isPending(entry.ticket.id)}
	<CalendarEntryItem
		{entry}
		{today}
		projectOf={(projectId) => (projectId === null ? null : catalog.projectById(projectId))}
		href={ticketHref}
		ruleHref={(ruleId) => calendarRuleHref(ruleId, page.url)}
		itemHref={(itemId) => calendarItemHref(itemId, page.url)}
		open={(ticketId) => ({
			panel: calendarTicketHref(ticketId, page.url),
			full: calendarFullViewHref(ticketId, page.url)
		})}
		{rowActions}
		{duplicates}
		tabbable={place.tabbable}
		look={place.look}
		dueLabel={place.dueLabel ?? false}
		move={pending ? null : (place.move ?? null)}
		moving={place.moving ?? false}
		{pending}
		active={entry.kind === 'ticket'
			? entry.ticket.id === activeId
			: entry.kind === 'planned'
				? entry.planned.ruleId === activeRuleId
				: entry.item.id === activeItemId}
	/>
{/snippet}

<section class="calendar" aria-labelledby={headingId}>
	<SectionBar
		title="Kalender"
		{headingId}
		count={tickets.openState === 'ready' ? total : null}
		countLabel={`${entryCountText(total)} im Zeitraum`}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="calendar" {inboxCount} projectsNewCount={tickets.newInProjects} />
		{/snippet}
		{#snippet end()}
			<div class="view-choice segmented" role="group" aria-label="Ansicht des Kalenders">
				{#each CALENDAR_VIEWS as choice (choice)}
					<button type="button" aria-pressed={view === choice} onclick={() => chooseView(choice)}>
						{CALENDAR_VIEW_LABELS[choice]}
					</button>
				{/each}
			</div>
			<CalendarLayers layers={prefs.layers} statusFilter={query.status} onchange={setLayer} />
			<a class="button-subtle" href={helpHref('kalender')}>So funktioniert’s</a>
		{/snippet}
	</SectionBar>

	<FilterBar {catalog} calendar />

	<div class="period">
		<div class="steps">
			<button class="button-secondary" type="button" onclick={toToday}>Heute</button>
			<button
				class="button-icon"
				type="button"
				aria-label={previousLabel}
				title={previousLabel}
				onclick={() => step(-1)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M10 3.5L5.5 8l4.5 4.5" />
				</svg>
			</button>
			<button
				class="button-icon"
				type="button"
				aria-label={nextLabel}
				title={nextLabel}
				onclick={() => step(1)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M6 3.5L10.5 8 6 12.5" />
				</svg>
			</button>
		</div>
		<h3 class="title" id={titleId} aria-live="polite">{periodTitle(period)}</h3>
	</div>

	{#if tickets.openState === 'error' && tickets.openError}
		<p class="alert-error" role="alert">
			<ErrorIcon />
			<span class="grow">Die Tickets konnten nicht geladen werden. {tickets.openError}</span>
			<button
				class="button-secondary button-small"
				type="button"
				onclick={() => void tickets.reload()}
			>
				Erneut versuchen
			</button>
		</p>
	{/if}
	{#if done.state === 'error' && done.error}
		<p class="alert-error" role="alert">
			<ErrorIcon />
			<span class="grow">Die erledigten Tickets konnten nicht geladen werden. {done.error}</span>
			<button
				class="button-secondary button-small"
				type="button"
				onclick={() => void done.reload()}
			>
				Erneut versuchen
			</button>
		</p>
	{:else if done.state === 'ready' && !done.complete}
		<SectionMessage tone="info" compact>
			Dieser Zeitraum hat mehr als 1.000 erledigte Tickets; der Kalender zeigt die 1.000 mit der
			frühesten Fälligkeit.
		</SectionMessage>
	{/if}

	{#if tickets.openState !== 'ready' && tickets.openState !== 'error'}
		<p class="loading" role="status">Tickets werden geladen …</p>
	{:else if view === 'agenda'}
		<CalendarAgenda {period} {today} {days} {overdue} {titleId} entry={entryItem} />
	{:else}
		<CalendarGrid
			{view}
			{period}
			{today}
			{days}
			{titleId}
			entry={entryItem}
			onoutside={(date) => void navigate({ date })}
			onmove={(ticketId, date) => tickets.moveDue(ticketId, date)}
		/>
	{/if}
</section>

<style>
	.calendar {
		min-width: 0;
	}

	.period {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.steps {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.steps svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.title {
		font-size: var(--font-size-title);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.loading {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.alert-error {
		margin-bottom: 0.75rem;
	}

	.grow {
		flex: 1;
	}
</style>
