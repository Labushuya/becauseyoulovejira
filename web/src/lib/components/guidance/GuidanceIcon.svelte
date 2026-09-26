<script lang="ts" module>
	/** Icons of the guidance building blocks (ADR-0026 section 2): own line drawings, no library. */
	export type GuidanceIconName =
		| 'info'
		| 'success'
		| 'warning'
		| 'error'
		| 'check'
		| 'pause'
		| 'pending'
		| 'refresh'
		| 'clock'
		| 'file'
		| 'tickets'
		| 'inbox'
		| 'projects'
		| 'channels'
		| 'search'
		| 'tags'
		| 'comments'
		| 'recurrence';
</script>

<script lang="ts">
	// Decorative icon in currentColor (Clean-Room, ADR-0010 section 4): the meaning always stands in
	// the text next to it, so the icon is hidden from screen readers.
	let { name, size = 16 }: { name: GuidanceIconName; size?: number } = $props();
</script>

<svg
	class="guidance-icon"
	class:large={size > 24}
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'info'}
		<circle cx="8" cy="8" r="6.5" />
		<path d="M8 7.25v4" />
		<circle class="dot" cx="8" cy="4.75" r="0.85" />
	{:else if name === 'success'}
		<circle cx="8" cy="8" r="6.5" />
		<path d="M5.25 8.25l1.9 1.9 3.6-4" />
	{:else if name === 'warning'}
		<path d="M8 1.75l6.5 12H1.5z" />
		<path d="M8 6.25v3.5" />
		<circle class="dot" cx="8" cy="11.75" r="0.85" />
	{:else if name === 'error'}
		<circle cx="8" cy="8" r="6.5" />
		<path d="M8 4.5v4.5" />
		<circle class="dot" cx="8" cy="11.5" r="0.85" />
	{:else if name === 'check'}
		<path d="M3.5 8.5l3 3 6-7" />
	{:else if name === 'pause'}
		<path d="M6 4v8M10 4v8" />
	{:else if name === 'pending'}
		<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2" />
	{:else if name === 'refresh'}
		<path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.75v2.5h-2.5" />
	{:else if name === 'clock'}
		<circle cx="8" cy="8" r="6" />
		<path d="M8 4.75V8l2.25 1.5" />
	{:else if name === 'file'}
		<path d="M4 1.75h5l3 3v9.5H4zM9 1.75v3h3" />
	{:else if name === 'tickets'}
		<path d="M2.5 3.5h11v9h-11zM5 6.5h6M5 9.5h4" />
	{:else if name === 'inbox'}
		<path d="M2.5 9.5l1.75-6h7.5l1.75 6v3.5h-11zM2.5 9.5h3l1 1.5h3l1-1.5h3" />
	{:else if name === 'projects'}
		<path d="M2.5 4.5v7.5h11V6H8L6.5 4.5z" />
	{:else if name === 'channels'}
		<path d="M3 11a7 7 0 0 1 10 0M5 8.75a4 4 0 0 1 6 0" />
		<circle class="dot" cx="8" cy="12.25" r="1" />
	{:else if name === 'search'}
		<circle cx="7" cy="7" r="4.25" />
		<path d="M10.25 10.25l3.25 3.25" />
	{:else if name === 'tags'}
		<path d="M2.5 2.5h5.25l5.75 5.75-5.25 5.25-5.75-5.75z" />
		<circle class="dot" cx="5.5" cy="5.5" r="0.9" />
	{:else if name === 'comments'}
		<path d="M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z" />
	{:else if name === 'recurrence'}
		<path d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1" />
		<path d="M3.25 1.75v3h3M12.75 14.25v-3h-3" />
	{/if}
</svg>

<style>
	.guidance-icon {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Large icons (empty states, 48 px) keep a fine line instead of a scaled heavy one. */
	.large {
		stroke-width: 0.75;
	}

	.dot {
		fill: currentColor;
		stroke: none;
	}
</style>
