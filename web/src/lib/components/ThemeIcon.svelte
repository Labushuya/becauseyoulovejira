<script lang="ts">
	import type { ThemePreference } from '$lib/theme.svelte';

	// Symbol of a theme choice (ADR-0025 section 10): sun, moon, screen. One drawing for the menu in
	// the header and the page "Darstellung" (plan EH-8); own lines in currentColor, decorative only.
	let { preference, size = 16 }: { preference: ThemePreference; size?: number } = $props();
</script>

<svg
	class="theme-icon"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
	focusable="false"
>
	{#if preference === 'light'}
		<circle cx="8" cy="8" r="2.75" />
		<path
			d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"
		/>
	{:else if preference === 'dark'}
		<path d="M13 9.6A5.25 5.25 0 0 1 6.4 3a5.25 5.25 0 1 0 6.6 6.6Z" />
	{:else}
		<rect x="2" y="2.75" width="12" height="8.5" rx="1" />
		<path d="M6 14h4M8 11.25V14" />
	{/if}
</svg>

<style>
	.theme-icon {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
