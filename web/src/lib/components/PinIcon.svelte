<script lang="ts">
	import { CHARM_SVG } from '$lib/domain/charm-icons';
	import { PIN_ICON } from '$lib/domain/pin-icon';

	// The pin of the pinned tickets (ADR-0064): "pin" of Lucide in the grid of the charms, in
	// currentColor, decorative (the button or heading around it names it). `filled` fills the head,
	// for a pinned ticket.
	let { filled = false }: { filled?: boolean } = $props();
</script>

<svg
	class="pin-icon"
	class:filled
	viewBox={CHARM_SVG.viewBox}
	fill={CHARM_SVG.fill}
	stroke={CHARM_SVG.stroke}
	stroke-width={CHARM_SVG.strokeWidth}
	stroke-linecap={CHARM_SVG.strokeLinecap}
	stroke-linejoin={CHARM_SVG.strokeLinejoin}
	aria-hidden="true"
	focusable="false"
>
	{#each PIN_ICON as shape, index (index)}
		{#if 'd' in shape}<path d={shape.d} />{/if}
	{/each}
</svg>

<style>
	.pin-icon {
		flex: none;
		width: 0.875rem;
		height: 0.875rem;
	}

	.filled path:last-child {
		fill: currentColor;
	}
</style>
