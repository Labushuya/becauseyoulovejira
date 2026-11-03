<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		PROBLEM_TEXTS,
		formatProblemTime,
		outcomeText,
		problemReport
	} from '$lib/domain/problems';
	import { SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
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
	let {
		focus = null,
		store = new ServerProblemsStore()
	}: {
		/** ID of the entry of the address, or null. */
		focus?: string | null;
		store?: ServerProblemsStore;
	} = $props();

	const uid = $props.id();
	const unfolded = new SvelteSet<string>();
	const items: Partial<Record<string, HTMLElement>> = $state({});

	$effect(() => {
		const id = focus;
		untrack(() => void store.load(id));
		return () => store.stop();
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
</script>

<div class="server-problems">
	{#if store.state === 'idle' || store.state === 'loading'}
		<p class="nothing" role="status">{SERVER_PROBLEM_TEXTS.loading}</p>
	{:else if store.state === 'offline'}
		<SectionMessage tone="warning" compact live>
			{SERVER_PROBLEM_TEXTS.offline}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.load(focus)}>
					{SERVER_PROBLEM_TEXTS.retry}
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state === 'failed'}
		<SectionMessage tone="error" compact live problem={store.problem}>
			{SERVER_PROBLEM_TEXTS.failed}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.load(focus)}>
					{SERVER_PROBLEM_TEXTS.retry}
				</button>
			{/snippet}
		</SectionMessage>
	{:else}
		{#if store.missing}
			<SectionMessage tone="info" compact live>{SERVER_PROBLEM_TEXTS.missing}</SectionMessage>
		{/if}
		{#if store.entries.length === 0}
			<p class="nothing">{SERVER_PROBLEM_TEXTS.noProblems}</p>
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
		<p class="limits">{SERVER_PROBLEM_TEXTS.limits}</p>
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
