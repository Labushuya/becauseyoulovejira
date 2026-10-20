<script lang="ts">
	import { addDays } from '$lib/domain/berlin-date';
	import { dayTitle, otherAreaText, progressText } from '$lib/domain/day-plan';
	import { ongoingFinishOf } from '$lib/domain/ongoing-finish';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import type { AreaStore } from '$lib/stores/area.svelte';
	import type { DayPlanStore, PlanRow } from '$lib/stores/day-plan.svelte';
	import { dayPlanDateHref } from '$lib/ticket-links';
	import CompletionDialog from '../CompletionDialog.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import OngoingFinishDialog from '../OngoingFinishDialog.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ProblemDetails from '../problems/ProblemDetails.svelte';
	import SectionBar from '../SectionBar.svelte';
	import ViewSwitch from '../ViewSwitch.svelte';
	import DayPlanList from './DayPlanList.svelte';
	import DayPlanPool from './DayPlanPool.svelte';
	import DayPlanSort from './DayPlanSort.svelte';
	import DayPlanSuggestions from './DayPlanSuggestions.svelte';

	// View "Tagesplan" (TP-1, ADR-0065 §4): the bridge between what is due today and long-running
	// projects. Head with the day (arrows to the day before and after, back to today), the progress
	// "3/7 erledigt" and, for an account in a household, the hint at the plan of the other area (how
	// many entries, never their content) with the way to switch; then the suggestions of today (they
	// fold), the plan and the pool, on a wide screen next to the plan, on a narrow one below it. Days
	// before are read-only, tomorrow can be planned; later days are not offered. A ticket opens next to
	// the plan (DAY_PLAN_HOST). The questions of a check mark (open blocking sub-tasks, "Vorhaben
	// abschließen …") are confirmations of the app (ADR-0025 §4); since VH-1 the latter is the one
	// question of every way to complete an ongoing project (OngoingFinishDialog). Next to the heading
	// "Plan" stands "Sortierung" (TP-5): a view of this device; sorted, the list names the hint as its
	// description. In the phone frame (MO-2, ADR-0073 addendum MO-2) the plan comes first: the head is
	// one compact block (the day between its arrows, the progress below), the suggestions follow the
	// plan, folded with their number, and the pool follows them as the folded section "Hinzufügen …".
	// Both are one level deeper, nothing is gone; folded or open is a choice of this view.
	let {
		store,
		area = null,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		store: DayPlanStore;
		/** The area of the tab; without it (tests) there is no hint at another area. */
		area?: AreaStore | null;
		inboxCount?: number | null;
		projectsNewCount?: number;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const dayId = `${uid}-day`;
	const sortHintId = `${uid}-sort-hint`;

	let heading = $state<HTMLElement>();
	const mobileLayout = getMobileLayoutStore();
	/** The phone frame (MO-2): the plan first, suggestions and pool after it and folded. */
	const phone = $derived(mobileLayout.active);
	// Folded at the start in the frame only; the PC keeps the suggestions open and the pool shown.
	let suggestionsOpen = $state(!mobileLayout.active);
	let poolOpen = $state(false);
	/** The ongoing project whose "Vorhaben abschließen …" asks. */
	let finishing = $state<PlanRow | null>(null);
	let finishBusy = $state(false);
	/** The question of "Vorhaben abschließen …", the same on every way (VH-1). */
	const finishQuestion = $derived(finishing?.ticket ? ongoingFinishOf(finishing.ticket) : null);

	const date = $derived(store.date);
	const today = $derived(store.today);
	const progress = $derived(progressText(store.progress.done, store.progress.total));
	const household = $derived(store.plan?.scope.startsWith('h:') ?? area?.active === 'household');
	const previousHref = $derived(dayPlanDateHref(addDays(date, -1)));
	const nextDate = $derived(addDays(date, 1));
	const nextHref = $derived(
		nextDate > store.tomorrow ? null : dayPlanDateHref(nextDate === today ? null : nextDate)
	);
	const todayHref = $derived(dayPlanDateHref(null));

	/** The other area of the account: "Im Haushalt" or "Privat", with its name for the switch. */
	const other = $derived.by(() => {
		const plan = store.other;
		if (plan === null || area === null || !area.visible) return null;
		const toHousehold = area.active === 'private';
		const name = toHousehold ? 'Im Haushalt' : 'Privat';
		return {
			text: otherAreaText(name, plan.count),
			switchLabel: toHousehold ? `Zum Haushalt ${area.household?.name ?? ''}`.trim() : 'Zu Privat',
			target: toHousehold ? ('household' as const) : ('private' as const)
		};
	});

	async function finish() {
		const row = finishing;
		if (row === null) return;
		finishBusy = true;
		await store.complete(row.item.id);
		finishBusy = false;
		finishing = null;
	}
</script>

<section class="day-plan-view" aria-labelledby={headingId}>
	<SectionBar title="Tagesplan" {headingId} bind:heading>
		{#snippet start()}
			<ViewSwitch current="dayplan" {inboxCount} {projectsNewCount} />
		{/snippet}
	</SectionBar>

	<header class="day-head">
		<nav class="day-nav" aria-label="Tag des Plans">
			<a class="button-icon" href={previousHref} aria-label="Vortag" title="Vortag">
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"
					><path d="M10 3.5L5.5 8l4.5 4.5" /></svg
				>
			</a>
			<h3 id={dayId} class="day-title" aria-live="polite">{dayTitle(date, today)}</h3>
			{#if nextHref !== null}
				<a class="button-icon" href={nextHref} aria-label="Folgetag" title="Folgetag">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"
						><path d="M6 3.5L10.5 8 6 12.5" /></svg
					>
				</a>
			{/if}
			{#if date !== today}
				<a class="button-subtle button-small" href={todayHref}>Heute</a>
			{/if}
		</nav>
		{#if store.state === 'ready' && store.progress.total > 0}
			<p class="progress">
				<span aria-hidden="true">{progress.text}</span>
				<span class="visually-hidden">{progress.spoken}</span>
			</p>
		{/if}
		{#if other !== null}
			<p class="other-area">
				<span>{other.text}</span>
				<button
					class="button-subtle button-small"
					type="button"
					onclick={() => area?.select(other.target)}>{other.switchLabel}</button
				>
			</p>
		{/if}
	</header>

	{#if store.state === 'missing'}
		<SectionMessage tone="info" title="Tagesplan">
			{restartNeeded('Der Tagesplan ist')}
		</SectionMessage>
	{:else if store.state === 'error'}
		<p class="alert-error" role="alert">
			<ErrorIcon /><span>Der Tagesplan konnte nicht geladen werden. {store.error}</span>
			<button
				class="button-secondary button-small"
				type="button"
				onclick={() => void store.reload()}>Erneut versuchen</button
			>
		</p>
		<ProblemDetails problem={store.errorProblem} />
	{:else if store.state === 'ready'}
		{#if !store.editable}
			<SectionMessage tone="info" compact>Vergangene Tage sind schreibgeschützt.</SectionMessage>
		{/if}
		{#snippet suggestions()}
			{#if store.isToday && store.editable}
				<DayPlanSuggestions {store} {household} bind:open={suggestionsOpen} />
			{/if}
		{/snippet}
		<div class="day-grid" class:with-pool={store.editable}>
			<div class="main">
				{#if !phone}
					{@render suggestions()}
				{/if}
				<section class="plan" aria-labelledby={`${uid}-plan`}>
					<div class="plan-head">
						<h3 id={`${uid}-plan`} class="plan-heading">Plan</h3>
						<DayPlanSort {store} {household} hintId={sortHintId} />
					</div>
					<DayPlanList
						{store}
						{household}
						describedby={store.sorted ? sortHintId : undefined}
						onfinish={(row) => (finishing = row)}
					/>
				</section>
				{#if phone}
					{@render suggestions()}
				{/if}
			</div>
			{#if store.editable}
				<DayPlanPool {store} bind:open={poolOpen} />
			{/if}
		</div>
	{:else}
		<p class="loading" aria-busy="true">Tagesplan wird geladen …</p>
	{/if}

	<div class="visually-hidden" role="status" aria-live="polite">{store.announcement}</div>
</section>

{#if store.completion}
	<CompletionDialog
		question={store.completion}
		busy={store.completing}
		error={store.completionError}
		onconfirm={(choice) => void store.confirmCompletion(choice)}
		oncancel={() => store.cancelCompletion()}
	/>
{/if}

{#if finishQuestion !== null}
	<OngoingFinishDialog
		question={finishQuestion}
		busy={finishBusy}
		onconfirm={() => void finish()}
		oncancel={() => (finishing = null)}
	/>
{/if}

<style>
	.day-plan-view {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.day-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		align-items: center;
	}

	.day-nav {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.day-nav svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.day-title {
		padding: 0 0.25rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.progress,
	.other-area {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.progress {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.day-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}

	/* The pool next to the plan on a wide screen, below it on a narrow one. */
	@media (min-width: 60rem) {
		.day-grid.with-pool {
			grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr);
		}
	}

	.main {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.plan {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	/* The heading and "Sortierung" in one row; the hint of a sorted plan below (DayPlanSort). */
	.plan-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		min-width: 0;
	}

	.plan-heading {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.loading {
		color: var(--color-text-muted);
	}

	@media (pointer: coarse) {
		.day-nav :global(.button-icon) {
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
		}
	}

	/*
	 * Phone frame (MO-2, ADR-0073 addendum MO-2): a compact head, the day between its arrows over the
	 * full width (it wraps instead of pushing anything out), the progress and the other area below.
	 * The arrows and "Heute" have their 44 px from base.css. The bar of the view holds only its
	 * heading for screen readers here and takes no room (SectionBar, since MO-3).
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .day-head {
			gap: 0.25rem 0.75rem;
		}

		:global(:root[data-mobile-layout='on']) .day-nav {
			flex: 1 1 100%;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .day-title {
			flex: 1;
			min-width: 0;
			text-align: center;
		}
	}
</style>
