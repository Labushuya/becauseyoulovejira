<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		PROBLEM_TEXTS,
		formatProblemTime,
		outcomeText,
		problemReport,
		type ProblemArea
	} from '$lib/domain/problems';
	import {
		SERVER_PROBLEM_AREA_LABELS,
		SERVER_PROBLEM_SOURCES,
		SERVER_PROBLEM_SOURCE_LABELS,
		SERVER_PROBLEM_TEXTS,
		type ServerProblemsFilter
	} from '$lib/domain/server-problems';
	import { ServerProblemsStore } from '$lib/stores/server-problems.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import CopyReportButton from './CopyReportButton.svelte';
	import ProblemFacts from './ProblemFacts.svelte';

	// The error log of the server in the dialog "Fehler" (FP-2, ADR-0077), with the building blocks of
	// the list of this tab (ProblemFacts, CopyReportButton): newest first, each entry with intent, time
	// of its last occurrence, short result and "3×", unfolding to its facts with area and Server-ID and
	// "Kopieren". An address `?fehler=<id>` (`focus`) loads that entry, puts it first, unfolds it and
	// moves the focus there; one that is gone or not visible says so. Loads once when it opens and on
	// "Erneut laden"; without a connection a hint instead of the list, nothing breaks.
	// On the page "Fehlerprotokoll" (`browse`, FP-3) above the list the filters "Quelle" and "Bereich"
	// as segments (state of the store, not in the address; "Bereich" only with more than one of
	// `areas`), and below it "Mehr laden" in steps of 50, told to screen readers in a hidden live line;
	// a new filter and "Erneut laden" start anew. The page passes its own store, so filters and loaded
	// pages stay while it shows "Diese Sitzung" (`resume`). The filters only narrow: what the account
	// sees at all is the decision of the server.
	let {
		focus = null,
		store = new ServerProblemsStore(),
		browse = false,
		areas = []
	}: {
		/** ID of the entry of the address, or null. */
		focus?: string | null;
		store?: ServerProblemsStore;
		/** The page "Fehlerprotokoll": filters and "Mehr laden" instead of the newest 50. */
		browse?: boolean;
		/** The areas the account may choose (serverProblemAreas). */
		areas?: readonly ProblemArea[];
	} = $props();

	const uid = $props.id();
	const unfolded = new SvelteSet<string>();
	const items: Partial<Record<string, HTMLElement>> = $state({});
	let moreButton = $state<HTMLButtonElement>();
	let moreRetryButton = $state<HTMLButtonElement>();

	const filtered = $derived(store.filter.source !== null || store.filter.area !== null);

	$effect(() => {
		const id = focus;
		untrack(() => void (browse ? store.resume() : store.load(id)));
		return () => store.stop();
	});

	// The chosen area is no longer offered (the account left its household): back to "Alle".
	$effect(() => {
		const area = store.filter.area;
		if (!browse || area === null || areas.includes(area)) return;
		untrack(() => void store.browse({ ...store.filter, area: null }));
	});

	// The entry of the address: unfolded, and the focus on it once it is there.
	$effect(() => {
		const id = store.focus;
		if (id === null) return;
		untrack(() => unfolded.add(id));
		void tick().then(() => items[id]?.focus());
	});

	function toggle(id: string) {
		if (unfolded.has(id)) unfolded.delete(id);
		else unfolded.add(id);
	}

	function choose(change: Partial<ServerProblemsFilter>) {
		const next = { ...store.filter, ...change };
		if (next.source === store.filter.source && next.area === store.filter.area) return;
		void store.browse(next);
	}

	function retry() {
		void (browse ? store.browse() : store.load(focus));
	}

	/**
	 * "Mehr laden" (also "Erneut versuchen" after a failure): the focus stays on the button; once the
	 * last page is there the button goes, and the focus goes to the first new entry, as it does when
	 * the button it was on went away. A failure puts the focus on "Erneut versuchen" of its message.
	 */
	async function loadMore() {
		const before = store.entries.length;
		await store.more();
		await tick();
		if (store.moreState === 'offline' || store.moreState === 'failed') {
			moreRetryButton?.focus();
			return;
		}
		const active = document.activeElement;
		const lost = active === null || active === document.body;
		if (moreButton?.isConnected && !lost) return;
		const entries = store.entries;
		const target = entries[before] ?? entries.at(-1);
		if (target !== undefined) items[target.id]?.focus();
	}
</script>

{#snippet segments(
	key: string,
	label: string,
	options: readonly { value: string | null; text: string }[],
	current: string | null,
	pick: (value: string | null) => void
)}
	<div class="filter">
		<span class="filter-label" id={`${uid}-${key}`}>{label}</span>
		<div class="segmented" role="group" aria-labelledby={`${uid}-${key}`}>
			{#each options as option (option.value ?? '')}
				<button
					type="button"
					aria-pressed={current === option.value}
					onclick={() => pick(option.value)}
				>
					{option.text}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class="server-problems">
	{#if browse}
		<div class="filters">
			{@render segments(
				'source',
				SERVER_PROBLEM_TEXTS.source,
				[
					{ value: null, text: SERVER_PROBLEM_TEXTS.all },
					...SERVER_PROBLEM_SOURCES.map((value) => ({
						value,
						text: SERVER_PROBLEM_SOURCE_LABELS[value]
					}))
				],
				store.filter.source,
				(value) =>
					choose({ source: SERVER_PROBLEM_SOURCES.find((source) => source === value) ?? null })
			)}
			{#if areas.length > 1}
				{@render segments(
					'area',
					SERVER_PROBLEM_TEXTS.area,
					[
						{ value: null, text: SERVER_PROBLEM_TEXTS.all },
						...areas.map((value) => ({ value, text: SERVER_PROBLEM_AREA_LABELS[value] }))
					],
					store.filter.area,
					(value) => choose({ area: areas.find((area) => area === value) ?? null })
				)}
			{/if}
		</div>
	{/if}
	{#if store.state === 'idle' || store.state === 'loading'}
		<p class="nothing" role="status">{SERVER_PROBLEM_TEXTS.loading}</p>
	{:else if store.state === 'offline'}
		<SectionMessage tone="warning" compact live>
			{SERVER_PROBLEM_TEXTS.offline}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={retry}>
					{SERVER_PROBLEM_TEXTS.retry}
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state === 'failed'}
		<SectionMessage tone="error" compact live problem={store.problem}>
			{SERVER_PROBLEM_TEXTS.failed}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={retry}>
					{SERVER_PROBLEM_TEXTS.retry}
				</button>
			{/snippet}
		</SectionMessage>
	{:else}
		{#if store.missing}
			<SectionMessage tone="info" compact live>{SERVER_PROBLEM_TEXTS.missing}</SectionMessage>
		{/if}
		{#if store.entries.length === 0}
			<p class="nothing">
				{filtered ? SERVER_PROBLEM_TEXTS.noMatch : SERVER_PROBLEM_TEXTS.noProblems}
			</p>
		{:else}
			<ol class="entries" aria-label={SERVER_PROBLEM_TEXTS.title}>
				{#each store.entries as entry (entry.id)}
					{@const open = unfolded.has(entry.id)}
					{@const panelId = `${uid}-${entry.id}`}
					{@const linked = entry.id === store.focus}
					<li class="entry" tabindex="-1" bind:this={items[entry.id]}>
						<div class="head">
							<span class="intent">{entry.intent}</span>
							{#if entry.count > 1}
								<span class="count">{entry.count}×</span>
							{/if}
							{#if linked}
								<span class="mark">{SERVER_PROBLEM_TEXTS.linked}</span>
							{/if}
						</div>
						<p class="meta">
							<time datetime={new Date(entry.lastAt).toISOString()}>
								{formatProblemTime(entry.lastAt)}
							</time>
							· {outcomeText(entry.outcome)}
						</p>
						<button
							class="button-subtle toggle"
							type="button"
							aria-expanded={open}
							aria-controls={open ? panelId : undefined}
							onclick={() => toggle(entry.id)}
						>
							{PROBLEM_TEXTS.details}<span class="visually-hidden"
								>: {entry.intent}, {formatProblemTime(entry.lastAt)}</span
							>
							<svg
								class="chevron"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								aria-hidden="true"
								focusable="false"
							>
								<path d="M4 6l4 4 4-4" />
							</svg>
						</button>
						{#if open}
							<div class="panel" id={panelId}>
								<ProblemFacts {entry} />
								<div class="actions">
									<CopyReportButton
										report={() => problemReport(entry)}
										label={PROBLEM_TEXTS.copy}
										copied={PROBLEM_TEXTS.copied}
									/>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
		{#if browse && store.moreState === 'offline'}
			<SectionMessage tone="warning" compact live>
				{SERVER_PROBLEM_TEXTS.moreOffline}
				{#snippet actions()}
					<button
						class="button-subtle"
						type="button"
						bind:this={moreRetryButton}
						onclick={loadMore}
					>
						{SERVER_PROBLEM_TEXTS.moreRetry}
					</button>
				{/snippet}
			</SectionMessage>
		{:else if browse && store.moreState === 'failed'}
			<SectionMessage tone="error" compact live problem={store.moreProblem}>
				{SERVER_PROBLEM_TEXTS.moreFailed}
				{#snippet actions()}
					<button
						class="button-subtle"
						type="button"
						bind:this={moreRetryButton}
						onclick={loadMore}
					>
						{SERVER_PROBLEM_TEXTS.moreRetry}
					</button>
				{/snippet}
			</SectionMessage>
		{:else if browse && store.hasMore}
			<div class="more">
				<button
					class="button-secondary"
					type="button"
					aria-busy={store.moreState === 'loading' ? 'true' : undefined}
					bind:this={moreButton}
					onclick={loadMore}
				>
					{store.moreState === 'loading'
						? SERVER_PROBLEM_TEXTS.loadingMore
						: SERVER_PROBLEM_TEXTS.more}
				</button>
			</div>
		{/if}
		<p class="limits">{SERVER_PROBLEM_TEXTS.limits}</p>
	{/if}
	{#if browse}
		<p class="visually-hidden" aria-live="polite">{store.announcement}</p>
	{/if}
</div>

<style>
	.server-problems {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		min-width: 0;
		font-size: var(--font-size-control);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		min-width: 0;
	}

	.filter {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.filter-label {
		font-weight: 500;
	}

	/*
	 * Phone frame (FP-3, ADR-0073): "Alle" and "App" are short, so every segment is at least as wide
	 * as a target of 44 px; the height comes from base.css.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .filter .segmented > button {
			min-width: var(--control-height-touch);
		}
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.nothing,
	.limits {
		color: var(--color-text-muted);
	}

	.limits {
		font-size: var(--font-size-small);
	}

	.entries {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		padding: 0.625rem 0;
		border-top: 1px solid var(--color-line);
	}

	.entry:focus-visible {
		outline-offset: 2px;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
		min-width: 0;
	}

	.intent {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.count,
	.mark {
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text);
		background: var(--fill-control);
		border-radius: var(--radius-pill);
	}

	.mark {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	.meta {
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.toggle {
		justify-self: start;
		font-size: var(--font-size-control);
	}

	.chevron {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: rotate var(--motion-fast) var(--motion-ease);
	}

	.toggle[aria-expanded='true'] .chevron {
		rotate: 180deg;
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	.panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
	}
</style>
