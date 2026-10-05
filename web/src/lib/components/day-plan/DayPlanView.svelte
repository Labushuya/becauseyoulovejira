<script lang="ts">
	import { addDays } from '$lib/domain/berlin-date';
	import { dayTitle, otherAreaText, progressText } from '$lib/domain/day-plan';
	import { restartNeeded } from '$lib/guidance/texts';
	import type { AreaStore } from '$lib/stores/area.svelte';
	import type { DayPlanStore, PlanRow } from '$lib/stores/day-plan.svelte';
	import { dayPlanDateHref } from '$lib/ticket-links';
	import CompletionDialog from '../CompletionDialog.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import SectionBar from '../SectionBar.svelte';
	import ViewSwitch from '../ViewSwitch.svelte';
	import DayPlanList from './DayPlanList.svelte';
	import DayPlanPool from './DayPlanPool.svelte';
	import DayPlanSuggestions from './DayPlanSuggestions.svelte';

	// View "Tagesplan" (TP-1, ADR-0065 §4): the bridge between what is due today and long-running
	// projects. Head with the day (arrows to the day before and after, back to today), the progress
	// "3/7 erledigt" and, for an account in a household, the hint at the plan of the other area (how
	// many entries, never their content) with the way to switch; then the suggestions of today (they
	// fold), the plan and the pool, on a wide screen next to the plan, on a narrow one below it. Days
	// before are read-only, tomorrow can be planned; later days are not offered. A ticket opens next to
	// the plan (DAY_PLAN_HOST). The questions of a check mark (open blocking sub-tasks, "Vorhaben
	// abschließen …") are confirmations of the app (ADR-0025 §4).
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

	let heading = $state<HTMLElement>();
	let suggestionsOpen = $state(true);
	/** The ongoing project whose "Vorhaben abschließen …" asks. */
	let finishing = $state<PlanRow | null>(null);
	let finishBusy = $state(false);

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
	{:else if store.state === 'ready'}
		{#if !store.editable}
			<SectionMessage tone="info" compact>Vergangene Tage sind schreibgeschützt.</SectionMessage>
		{/if}
		<div class="day-grid" class:with-pool={store.editable}>
			<div class="main">
				{#if store.isToday && store.editable}
					<DayPlanSuggestions {store} {household} bind:open={suggestionsOpen} />
				{/if}
				<section class="plan" aria-labelledby={`${uid}-plan`}>
					<h3 id={`${uid}-plan`} class="plan-heading">Plan</h3>
					<DayPlanList {store} {household} onfinish={(row) => (finishing = row)} />
				</section>
			</div>
			{#if store.editable}
				<DayPlanPool {store} />
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

{#if finishing !== null}
	<ConfirmDialog
		open
		title={`${finishing.ticket?.key ?? 'Vorhaben'} abschließen?`}
		confirmLabel="Abschließen"
		busy={finishBusy}
		onconfirm={() => void finish()}
		oncancel={() => (finishing = null)}
	>
		<p>
			Das laufende Vorhaben „{finishing.ticket?.title ?? ''}“ wird erledigt und kommt nicht mehr in
			den Tagesplan. Für einen Tag allein reicht der Haken.
		</p>
	</ConfirmDialog>
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
</style>
