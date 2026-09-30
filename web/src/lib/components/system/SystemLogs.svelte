<script lang="ts">
	import EmptyState from '$lib/components/guidance/EmptyState.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		LOG_SETS,
		LOG_SET_LABELS,
		formatPointInTime,
		sizeText,
		type LogSetName,
		type SystemLogs
	} from '$lib/domain/system';
	import type { SystemPart } from '$lib/stores/system.svelte';

	// "Logs ansehen" on the page System (ADR-0043): the last lines of the logs of the server, the
	// mail helper and the control script, one log at a time (segmented switch), each file with size
	// and time of its last change. The server has removed access data, paths of addresses, e-mail
	// addresses and tokens; the lines are shown as text only. "Aktualisieren" reads them again.
	let { part, onload }: { part: SystemPart<SystemLogs>; onload: () => void } = $props();

	const uid = $props.id();
	let chosen = $state<LogSetName>('server');

	const loading = $derived(part.state === 'loading');
	const files = $derived(part.value?.logs.find((set) => set.name === chosen)?.files ?? []);

	function load() {
		if (!loading) onload();
	}
</script>

{#if part.state === 'idle'}
	<div>
		<button class="button-secondary" type="button" onclick={load}>Logs ansehen</button>
	</div>
{:else}
	<div class="toolbar">
		<div class="segmented" role="group" aria-label="Log">
			{#each LOG_SETS as name (name)}
				<button type="button" aria-pressed={chosen === name} onclick={() => (chosen = name)}>
					{LOG_SET_LABELS[name]}
				</button>
			{/each}
		</div>
		<button
			class="button-subtle"
			type="button"
			aria-busy={loading}
			aria-disabled={loading}
			onclick={load}
		>
			Aktualisieren
		</button>
	</div>
	<div role="status" class="state">
		{#if loading}
			<p class="note">Logs werden geladen …</p>
		{:else if part.message !== null}
			<SectionMessage
				tone={part.state === 'error' ? 'error' : 'warning'}
				title={part.message.title}
			>
				{part.message.text}
			</SectionMessage>
		{/if}
	</div>
	{#if part.value !== null}
		{#each files as file (file.file)}
			<figure class="file">
				<figcaption id={`${uid}-${file.file}`}>
					<code>logs\{file.file}</code>
					{#if file.exists}
						<span class="meta">
							{sizeText(file.sizeBytes)}{#if file.modifiedUtc !== null}, geändert {formatPointInTime(
									file.modifiedUtc
								)}{/if}
						</span>
					{:else}
						<span class="meta">noch nicht vorhanden</span>
					{/if}
				</figcaption>
				{#if file.lines.length > 0}
					<!-- A scrollable region the keyboard reaches (WCAG 2.1.1). -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						class="lines"
						tabindex="0"
						role="region"
						aria-labelledby={`${uid}-${file.file}`}>{file.lines.join('\n')}</pre>
				{:else if file.exists}
					<EmptyState
						size="compact"
						headingLevel={4}
						title="Keine Einträge"
						description="Die Datei ist leer."
					/>
				{/if}
			</figure>
		{/each}
	{/if}
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.file {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		min-width: 0;
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
		font-size: var(--font-size-body);
	}

	.meta {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.lines {
		max-height: 24rem;
		margin: 0;
		padding: 0.75rem;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}
</style>
