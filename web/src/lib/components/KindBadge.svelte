<script lang="ts">
	import { KIND_LABELS, ONGOING_BADGE, kindOf } from '$lib/domain/day-plan';

	// The badge "Vorhaben" of an ongoing project (ADR-0065 §1): small, quiet and next to the title in
	// the detail, the lists and the day plan; a task shows nothing. Not interactive; the symbol is
	// decorative, the text is read, the tooltip names the kind in full. Never a color of its own: the
	// line and the muted text of the app, like a quiet lozenge.
	let {
		kind
	}: {
		/** The stored kind; anything but "ongoing" (also before the migration) shows nothing. */
		kind: string | null | undefined;
	} = $props();
</script>

{#if kindOf(kind) === 'ongoing'}
	<span class="kind-badge" title={KIND_LABELS.ongoing} data-kind="ongoing">
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" />
			<path d="M8 5v3l2 1.5" />
		</svg>
		{ONGOING_BADGE}
	</span>
{/if}

<style>
	.kind-badge {
		display: inline-flex;
		flex: none;
		gap: 0.25rem;
		align-items: center;
		padding: 0 0.375rem;
		font-size: var(--font-size-caption);
		font-weight: 500;
		line-height: 1.125rem;
		white-space: nowrap;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
