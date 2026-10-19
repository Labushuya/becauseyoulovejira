<script lang="ts">
	import { untrack } from 'svelte';
	import {
		PROBLEM_TEXTS,
		allProblemsLabel,
		problemReport,
		type ProblemEntry
	} from '$lib/domain/problems';
	import { insideModal } from '$lib/overlay/modal-context';
	import { problemLog } from '$lib/stores/problem-log.svelte';
	import InlineDialog from '../InlineDialog.svelte';
	import CopyReportButton from './CopyReportButton.svelte';
	import ProblemFacts from './ProblemFacts.svelte';
	import SessionProblemList from './SessionProblemList.svelte';

	// "Details" of the message of a failed action (FP-1, ADR-0071): a disclosure row right below the
	// message (SectionMessage, alert, field error, flag) with intent, time, result, request and
	// build, "Kopieren" for the report as plain text and "Alle Fehler dieser Sitzung (n)". Shown, the
	// message takes its entry into the list of the session, once per entry. Without an entry (a hint
	// at an input, an aborted request, a text of the app itself) it renders nothing, so a message
	// passes `problemOf(failure)` as it comes. No dialog from a dialog (ADR-0025 addendum 16): inside
	// a modal (also a flag in front of one) the list unfolds here as an embedded area; elsewhere it
	// opens the dialog of the root layout. Folded by default; the button carries the intent for
	// screen readers, so two messages are told apart.
	let { problem }: { problem: ProblemEntry | null | undefined } = $props();

	const uid = $props.id();
	const panelId = `${uid}-panel`;
	const inline = insideModal();
	let open = $state(false);
	let listOpen = $state(false);

	// The message is shown: its entry goes into the list (the log ignores an entry it has).
	$effect(() => {
		const entry = problem ?? null;
		untrack(() => problemLog.record(entry));
	});

	function showAll() {
		if (inline) listOpen = !listOpen;
		else problemLog.openDialog();
	}
</script>

{#if problem}
	{@const entry = problem}
	<div class="problem-details" data-problem-details>
		<button
			class="button-subtle toggle"
			type="button"
			aria-expanded={open}
			aria-controls={open ? panelId : undefined}
			onclick={() => (open = !open)}
		>
			{PROBLEM_TEXTS.details}<span class="visually-hidden">: {entry.intent}</span>
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
					<button
						class="button-subtle"
						type="button"
						aria-haspopup={inline ? undefined : 'dialog'}
						aria-expanded={inline ? listOpen : undefined}
						onclick={showAll}
					>
						{allProblemsLabel(problemLog.count)}
					</button>
				</div>
				{#if inline}
					<InlineDialog
						open={listOpen}
						title={PROBLEM_TEXTS.listTitle}
						onclose={() => (listOpen = false)}
					>
						<SessionProblemList />
						{#snippet footer({ close })}
							<button class="button-secondary" type="button" onclick={close}>Schließen</button>
						{/snippet}
					</InlineDialog>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.problem-details {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
		font-size: var(--font-size-control);
		color: var(--color-text);
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
		padding: 0.5rem 0 0.25rem;
		border-top: 1px solid var(--color-line);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
	}
</style>
