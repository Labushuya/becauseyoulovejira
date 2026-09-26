<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { StepCheck } from '$lib/domain/channel-setup';
	import GuidanceIcon, { type GuidanceIconName } from '../guidance/GuidanceIcon.svelte';

	// Check line of a step in the assistant (plan EH-5 §3.8): icon (✓, ○, ⚠ or error) and the text
	// of what exactly was checked ("Die App sieht BYL_…", never "richtig eingerichtet"), then an
	// optional action such as "Erneut prüfen". It is a status, so a screen reader hears a new result
	// without the focus moving; red only for a real error (ADR-0009).
	let { check, actions }: { check: StepCheck; actions?: Snippet } = $props();

	const ICONS: Readonly<Record<StepCheck['tone'], GuidanceIconName>> = {
		done: 'success',
		open: 'pending',
		warning: 'warning',
		error: 'error'
	};
	const PREFIX: Readonly<Record<StepCheck['tone'], string>> = {
		done: 'Geprüft:',
		open: 'Offen:',
		warning: 'Achtung:',
		error: 'Fehler:'
	};
</script>

<div class="check" data-tone={check.tone}>
	<p role="status">
		<GuidanceIcon name={ICONS[check.tone]} size={14} />
		<span><span class="visually-hidden">{PREFIX[check.tone]} </span>{check.text}</span>
	</p>
	{#if actions}
		<div class="actions">{@render actions()}</div>
	{/if}
</div>

<style>
	.check {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
	}

	p {
		display: flex;
		flex: 1;
		gap: 0.375rem;
		align-items: flex-start;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	p :global(svg) {
		flex: none;
		margin-top: 0.1875rem;
	}

	[data-tone='done'] p {
		color: var(--color-brand-text);
	}

	[data-tone='open'] p {
		color: var(--color-text-muted);
	}

	[data-tone='warning'] p {
		font-weight: 600;
	}

	[data-tone='error'] p {
		color: var(--color-danger);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
