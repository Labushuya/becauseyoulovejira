<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		PROBLEM_TEXTS,
		formatProblemTime,
		outcomeText,
		problemReport,
		problemsReport
	} from '$lib/domain/problems';
	import { problemLog, type ProblemLog } from '$lib/stores/problem-log.svelte';
	import CopyReportButton from './CopyReportButton.svelte';
	import ProblemFacts from './ProblemFacts.svelte';

	// The list "Fehler dieser Sitzung" (FP-1, ADR-0071 §4), in the dialog of the root layout and,
	// inside a modal, embedded below the details of a message: newest first, each entry with intent,
	// time, short result and "3×" for a repeated one, unfolding to the facts of its details with
	// "Kopieren". "Alle kopieren" takes every report, "Liste leeren" empties the list; then the focus
	// goes to the sentence of the empty list, which a status also says.
	let { log = problemLog }: { log?: ProblemLog } = $props();

	const uid = $props.id();
	const unfolded = new SvelteSet<string>();
	let status = $state('');
	let nothing = $state<HTMLElement>();

	function toggle(id: string) {
		if (unfolded.has(id)) unfolded.delete(id);
		else unfolded.add(id);
	}

	async function clear() {
		log.clear();
		unfolded.clear();
		status = PROBLEM_TEXTS.cleared;
		await tick();
		nothing?.focus();
	}
</script>

<div class="session-problems">
	{#if log.count === 0}
		<p class="nothing" tabindex="-1" bind:this={nothing}>{PROBLEM_TEXTS.noProblems}</p>
	{:else}
		<div class="toolbar">
			<CopyReportButton
				report={() => problemsReport(log.entries)}
				label={PROBLEM_TEXTS.copyAll}
				copied={PROBLEM_TEXTS.copiedAll}
			/>
			<button class="button-subtle" type="button" onclick={clear}>{PROBLEM_TEXTS.clear}</button>
		</div>
		<ol class="entries" aria-label={PROBLEM_TEXTS.listTitle}>
			{#each log.entries as entry (entry.id)}
				{@const open = unfolded.has(entry.id)}
				{@const panelId = `${uid}-${entry.id}`}
				<li class="entry">
					<div class="head">
						<span class="intent">{entry.intent}</span>
						{#if entry.count > 1}
							<span class="count">{entry.count}×</span>
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
	<p class="visually-hidden" role="status">{status}</p>
</div>

<style>
	.session-problems {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		min-width: 0;
		font-size: var(--font-size-control);
	}

	.nothing {
		color: var(--color-text-muted);
	}

	.toolbar,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
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

	.count {
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text);
		background: var(--fill-control);
		border-radius: var(--radius-pill);
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
</style>
