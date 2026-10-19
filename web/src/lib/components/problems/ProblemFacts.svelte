<script lang="ts">
	import { PROBLEM_TEXTS, problemFacts, type ProblemEntry } from '$lib/domain/problems';

	// The facts of a failed action (FP-1, ADR-0071): intent, time, how often, result, code and
	// message of the server, request and build of the app as rows of name and value, like the
	// details of a channel card; for an unexpected exception "Technische Details" folded below with
	// name, message and the short stack. Long paths and messages wrap, so it works from 340 px.
	let { entry }: { entry: ProblemEntry } = $props();

	const uid = $props.id();
	const facts = $derived(problemFacts(entry));
	const exception = $derived(entry.exception);
	const technical = $derived(
		exception === null
			? ''
			: [
					exception.message === '' ? exception.name : `${exception.name}: ${exception.message}`,
					...exception.stack.map((line) => `  ${line}`)
				].join('\n')
	);
	let technicalOpen = $state(false);

	/** Values in the mono font: the request and the codes. */
	const MONO = new Set<string>([PROBLEM_TEXTS.request, PROBLEM_TEXTS.code]);
</script>

<dl class="facts">
	{#each facts as fact (fact.label)}
		<div class="fact">
			<dt>{fact.label}</dt>
			<dd>
				{#if MONO.has(fact.label)}<code>{fact.value}</code>{:else}{fact.value}{/if}
			</dd>
		</div>
	{/each}
</dl>
{#if exception !== null}
	<button
		class="button-subtle toggle"
		type="button"
		aria-expanded={technicalOpen}
		aria-controls={technicalOpen ? `${uid}-technical` : undefined}
		onclick={() => (technicalOpen = !technicalOpen)}
	>
		{PROBLEM_TEXTS.technical}
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
	{#if technicalOpen}
		<pre class="technical" id={`${uid}-technical`}>{technical}</pre>
	{/if}
{/if}

<style>
	.facts {
		display: grid;
		gap: 0.25rem;
		margin: 0;
	}

	.fact {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
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

	.technical {
		max-width: 100%;
		margin: 0;
		padding: 0.5rem 0.625rem;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		line-height: 1.5;
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}
</style>
