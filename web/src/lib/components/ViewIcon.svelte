<script lang="ts">
	import type { AreaView } from '$lib/domain/area';

	// Symbol of a view (ADR-0066 §1), the same in the navigation of the views and in the bottom bar
	// and "Mehr" of the phone frame (MO-1a, ADR-0073). Always decorative: the name of the view stands
	// next to it as text. The size comes from the place (`--view-icon-size`, 0.875rem by default).
	let { view }: { view: AreaView } = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
	{#if view === 'tasks'}
		<path d="M3 4h10M3 8h10M3 12h6" />
	{:else if view === 'dayplan'}
		<path d="M3 3.5h10v10H3zM3 6.5h10M5.5 9.25l1.5 1.5 3-3" />
	{:else if view === 'projects'}
		<path d="M2.5 4.5v7.5h11V6H8L6.5 4.5z" />
	{:else if view === 'inbox'}
		<path d="M2.5 9.5l1.75-6h7.5l1.75 6v3.5h-11zM2.5 9.5h3l1 1.5h3l1-1.5h3" />
	{:else if view === 'recurrences'}
		<path d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1" />
		<path d="M3.25 1.75v3h3M12.75 14.25v-3h-3" />
	{:else if view === 'calendar'}
		<path d="M2.5 4.5h11v9h-11zM2.5 7.5h11M5.5 2.5v3M10.5 2.5v3" />
	{:else if view === 'done'}
		<circle cx="8" cy="8" r="5.5" />
		<path d="M5.5 8.25l1.75 1.75 3.25-3.5" />
	{:else}
		<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9M7 7v4M9 7v4" />
	{/if}
</svg>

<style>
	svg {
		width: var(--view-icon-size, 0.875rem);
		height: var(--view-icon-size, 0.875rem);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
