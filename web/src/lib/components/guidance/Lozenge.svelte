<script lang="ts">
	import GuidanceIcon, { type GuidanceIconName } from './GuidanceIcon.svelte';

	// Lozenge (ADR-0026 section 2, ADS pattern "lozenge", only "subtle"): a short, non-interactive
	// state in sentence case, always with an icon, so the colour is never the only sign. Tones:
	// neutral (outline), brand (brand surface), danger (only for a real error, ADR-0009) and muted
	// (background surface). The text is part of the page and read by screen readers.
	let {
		label,
		icon,
		tone = 'neutral',
		id
	}: {
		label: string;
		icon: GuidanceIconName;
		tone?: 'neutral' | 'brand' | 'danger' | 'muted';
		/** For aria-describedby of an element the lozenge belongs to. */
		id?: string;
	} = $props();
</script>

<span class="lozenge {tone}" data-tone={tone} {id}>
	<GuidanceIcon name={icon} size={12} />
	<span class="label">{label}</span>
</span>

<style>
	.lozenge {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		max-width: 12.5rem;
		padding: 0 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.25rem;
		white-space: nowrap;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.neutral {
		color: var(--color-text-muted);
		border-color: var(--color-line);
	}

	.brand {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	.danger {
		color: var(--color-danger);
		background: var(--color-danger-soft-bg);
	}

	.muted {
		color: var(--color-text-muted);
		background: var(--color-bg);
		border-color: var(--color-line);
	}
</style>
