<script lang="ts">
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import {
		COMMAND_PLACEHOLDERS,
		SCRIPT_PROBLEMS,
		commandTemplate,
		fillText,
		helpValues
	} from '$lib/domain/script-problems';

	// Frequent problems of the scripts in the section "Betrieb" of the help (ADR-0048, plan
	// robuste-skripte RS-1): the entries of the catalog app/byl-problems.ps1 with a question, in its
	// words (domain/script-problems.ts, parity test). The scripts print the same texts with the full
	// paths of this machine; here the commands are those for PowerShell in the folder app. One
	// <details> per problem, like the frequent questions of the help.
	let { origin, port }: { origin: string; port: string } = $props();

	const values = $derived(helpValues(origin, port));
	const placeholders = Object.fromEntries(
		Object.entries(COMMAND_PLACEHOLDERS).map(([name, label]) => [name, { label, secret: false }])
	);
</script>

<div class="script-problems">
	<p>
		Geht beim Starten, Beenden oder Sichern etwas schief, sagt das Fenster des Skripts, was passiert
		ist, warum und was hilft, mit einem Befehl zum Kopieren und den Pfaden deines Rechners. Hier
		stehen dieselben Texte; die Befehle gelten für PowerShell im Ordner <code>app</code>.
	</p>
	<div class="faq">
		{#each SCRIPT_PROBLEMS as problem (problem.code)}
			<details>
				<summary>{problem.question}</summary>
				<p>{fillText(problem.problem, values)}</p>
				<p><strong>Ursache:</strong> {fillText(problem.cause, values)}</p>
				{#if problem.steps.length === 1}
					<p><strong>So geht's:</strong> {fillText(problem.steps[0] ?? '', values)}</p>
				{:else}
					<p><strong>So geht's:</strong></p>
					<ol>
						{#each problem.steps as step (step)}
							<li>{fillText(step, values)}</li>
						{/each}
					</ol>
				{/if}
				{#if problem.command !== ''}
					<CodeBlock
						code={commandTemplate(problem.command, values)}
						label="Befehl zum Kopieren (PowerShell im Ordner app)"
						{placeholders}
					/>
				{/if}
			</details>
		{/each}
	</div>
</div>

<style>
	.script-problems {
		display: grid;
		gap: 0.625rem;
	}

	.faq {
		display: grid;
		gap: 0.5rem;
	}

	p,
	li,
	summary {
		font-size: var(--font-size-body);
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	details {
		padding: 0.625rem 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	details[open] > * + * {
		margin-top: 0.5rem;
	}

	summary {
		font-weight: 500;
		cursor: pointer;
	}
</style>
