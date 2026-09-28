<script lang="ts" module>
	export type EditorIconName =
		| 'bold'
		| 'italic'
		| 'underline'
		| 'strike'
		| 'more'
		| 'bulletList'
		| 'orderedList'
		| 'taskList'
		| 'blockquote'
		| 'codeBlock'
		| 'horizontalRule'
		| 'overflow'
		| 'chevron';
</script>

<script lang="ts">
	// Symbols of the editor toolbar (ADR-0032, plan editor section 3.2): own lines in currentColor
	// on a 16 grid, decorative only; the buttons carry the names.
	let { name, size = 16 }: { name: EditorIconName; size?: number } = $props();
</script>

<svg
	class="editor-icon"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'bold'}
		<path d="M4.5 2.75h4.25a2.6 2.6 0 0 1 0 5.2H4.5ZM4.5 7.95h4.9a2.65 2.65 0 0 1 0 5.3H4.5Z" />
	{:else if name === 'italic'}
		<path d="M6.5 2.75h5M4.5 13.25h5M9.75 2.75l-3.5 10.5" />
	{:else if name === 'underline'}
		<path d="M4.5 2.5v4.75a3.5 3.5 0 0 0 7 0V2.5M3.5 14h9" />
	{:else if name === 'strike'}
		<path
			d="M11.25 4.25C10.8 3.2 9.6 2.5 8 2.5c-2 0-3.25 1.05-3.25 2.5 0 .9.45 1.55 1.3 2M2.5 8h11M10.4 9.3c.55.45.85 1 .85 1.7 0 1.5-1.35 2.5-3.25 2.5-1.7 0-3.05-.75-3.5-2"
		/>
	{:else if name === 'more'}
		<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3" />
	{:else if name === 'bulletList'}
		<circle cx="3" cy="4" r="0.75" class="dot" />
		<circle cx="3" cy="8" r="0.75" class="dot" />
		<circle cx="3" cy="12" r="0.75" class="dot" />
		<path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
	{:else if name === 'orderedList'}
		<path
			d="M2.25 2.75h1v3M2.25 5.75h2M2.25 9.5c.2-.5.6-.75 1.05-.75.55 0 .95.35.95.85 0 .9-2 1.4-2 2.65h2M6.5 4h7M6.5 11h7"
		/>
	{:else if name === 'taskList'}
		<rect x="2" y="2.5" width="4" height="4" rx="1" />
		<path d="m2.9 11.5 1 1 1.6-2.1" />
		<path d="M8.5 4.5h5M8.5 11.5h5" />
	{:else if name === 'blockquote'}
		<path d="M3 3v10M6 4.5h7.5M6 8h7.5M6 11.5h5" />
	{:else if name === 'codeBlock'}
		<rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" />
		<path d="M6.25 6 4.5 8l1.75 2M9.75 6l1.75 2-1.75 2" />
	{:else if name === 'horizontalRule'}
		<path d="M2 8h12M4.5 4.5h7M4.5 11.5h7" class="soft" />
	{:else if name === 'overflow'}
		<circle cx="3.5" cy="8" r="0.9" class="dot" />
		<circle cx="8" cy="8" r="0.9" class="dot" />
		<circle cx="12.5" cy="8" r="0.9" class="dot" />
	{:else}
		<path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
	{/if}
</svg>

<style>
	.editor-icon {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dot {
		fill: currentColor;
	}

	.soft {
		stroke-width: 1.25;
	}
</style>
