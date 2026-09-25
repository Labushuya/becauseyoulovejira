<script lang="ts" module>
	export type SectionMessageTone = 'info' | 'success' | 'warning' | 'error';

	/** Hidden prefix per tone, so the tone never depends on colour or icon alone. */
	export const TONE_PREFIX: Readonly<Record<SectionMessageTone, string>> = {
		info: 'Hinweis:',
		success: 'Erledigt:',
		warning: 'Achtung:',
		error: 'Fehler:'
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import GuidanceIcon from './GuidanceIcon.svelte';

	// Section message (ADR-0026 section 2, ADS pattern "section message" and, compact, "inline
	// message"): icon, optional title, text and actions for a hint that stays until the situation is
	// solved. Four tones with the tokens of ADR-0009: red only for "error"; a warning is neutral and
	// differs by icon, bold title and line, never by yellow. The tone also stands as a hidden prefix.
	// Only with `live` is it announced (status, errors alert); static hints have no role, and the
	// focus never moves because of a message. Not an overlay (ADR-0025 section 12).
	let {
		tone,
		title,
		compact = false,
		live = false,
		headingLevel = 3,
		children,
		actions
	}: {
		tone: SectionMessageTone;
		title?: string;
		/** Without surface and title, small icon and text (ADS "inline message"). */
		compact?: boolean;
		/** For messages that appear while the page is shown. */
		live?: boolean;
		/** Level of the title as heading; only with a title and not compact. */
		headingLevel?: 3 | 4;
		children: Snippet;
		actions?: Snippet;
	} = $props();

	const role = $derived(live ? (tone === 'error' ? 'alert' : 'status') : undefined);
	const showTitle = $derived(title !== undefined && title !== '' && !compact);
</script>

<div class="section-message {tone}" class:compact {role} data-tone={tone}>
	<GuidanceIcon name={tone} size={compact ? 14 : 16} />
	<div class="body">
		{#if showTitle}
			<svelte:element this={`h${headingLevel}`} class="title">
				<span class="visually-hidden">{TONE_PREFIX[tone]}</span>
				{title}
			</svelte:element>
			<div class="text">{@render children()}</div>
		{:else}
			<div class="text">
				<span class="visually-hidden">{TONE_PREFIX[tone]}</span>
				{@render children()}
			</div>
		{/if}
		{#if actions}
			<div class="actions">{@render actions()}</div>
		{/if}
	</div>
</div>

<style>
	.section-message {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
		padding: 0.75rem 0.875rem;
		font-size: 0.875rem;
		line-height: 1.45;
		border-left: 3px solid;
		border-radius: var(--radius-surface);
	}

	.section-message > :global(svg) {
		margin-top: 0.125rem;
	}

	.body {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.title {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
	}

	.actions :global(a) {
		color: inherit;
		font-weight: 600;
	}

	/* Tones (ADR-0009, ADR-0026 section 2): no new colours. */
	.info,
	.success {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-left-color: var(--color-brand);
	}

	.warning {
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-left: 3px solid var(--color-text-muted);
	}

	.warning .title {
		font-weight: 700;
	}

	.error {
		color: var(--color-danger);
		background: var(--color-danger-soft-bg);
		border-left-color: var(--color-danger);
	}

	/* Compact: no surface and no title, small icon and text (ADS "inline message"). */
	.compact {
		gap: 0.375rem;
		padding: 0;
		font-size: 0.8125rem;
		background: none;
		border: none;
	}

	.compact.info,
	.compact.success {
		color: var(--color-brand-text);
	}

	.compact.warning {
		color: var(--color-text);
	}

	.compact.warning > :global(svg) {
		color: var(--color-text-muted);
	}
</style>
