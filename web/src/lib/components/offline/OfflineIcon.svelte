<script lang="ts">
	import { CHARM_SVG } from '$lib/domain/charm-icons';
	import { OFFLINE_ICON, PENDING_ICON } from '$lib/domain/offline-icons';

	// The symbols of the outbox (OF-2): "cloud-upload" of Lucide for a change that is not sent yet,
	// "cloud-off" for the missing connection; in currentColor and decorative (the text beside it or
	// the name of its button says what it means).
	let { kind = 'pending' }: { kind?: 'pending' | 'offline' } = $props();

	const shapes = $derived(kind === 'offline' ? OFFLINE_ICON : PENDING_ICON);
</script>

<svg
	class="offline-icon"
	viewBox={CHARM_SVG.viewBox}
	fill={CHARM_SVG.fill}
	stroke={CHARM_SVG.stroke}
	stroke-width={CHARM_SVG.strokeWidth}
	stroke-linecap={CHARM_SVG.strokeLinecap}
	stroke-linejoin={CHARM_SVG.strokeLinejoin}
	aria-hidden="true"
	focusable="false"
>
	{#each shapes as shape, index (index)}
		{#if 'd' in shape}<path d={shape.d} />{/if}
	{/each}
</svg>

<style>
	.offline-icon {
		flex: none;
		width: 1em;
		height: 1em;
	}
</style>
