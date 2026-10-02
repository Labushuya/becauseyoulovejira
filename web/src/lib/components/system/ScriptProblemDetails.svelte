<script lang="ts">
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import type { ScriptProblemReport } from '$lib/domain/system';

	// An entry of the catalog of the scripts (ADR-0048) on the page System, in the words of the window
	// of the script: the facts of the case, the cause, the steps, the command to copy with the paths
	// of this machine and the log with the details. The problem itself stands around it (title of the
	// message or text of the check).
	let { report }: { report: ScriptProblemReport } = $props();

	const steps = $derived(report.remedy.steps);
</script>

<div class="problem-details">
	{#if report.facts.length > 0}
		<ul class="facts">
			{#each report.facts as fact, index (index)}
				<li>{fact}</li>
			{/each}
		</ul>
	{/if}
	{#if report.cause !== ''}
		<p><strong>Ursache:</strong> {report.cause}</p>
	{/if}
	{#if steps.length === 1}
		<p><strong>So geht's:</strong> {steps[0]}</p>
	{:else if steps.length > 1}
		<p><strong>So geht's:</strong></p>
		<ol>
			{#each steps as step, index (index)}
				<li>{step}</li>
			{/each}
		</ol>
	{/if}
	{#if report.remedy.command !== ''}
		<CodeBlock code={report.remedy.command} label="Befehl zum Kopieren" />
	{/if}
	{#if report.log !== ''}
		<p class="log"><strong>Details:</strong> <code>{report.log}</code></p>
	{/if}
</div>

<style>
	.problem-details {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	p,
	li {
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.facts {
		display: grid;
		gap: 0.125rem;
		list-style: none;
		color: var(--color-text-muted);
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}
</style>
