<script lang="ts" module>
	/** Kinds of channel symbols (ADR-0026 section 3): own drawings, no brand logos. */
	export type ChannelIconKind =
		'calendar' | 'telegram' | 'mail' | 'proton' | 'files' | 'bookmarklet' | 'api';
</script>

<script lang="ts">
	// Symbol of a channel in a tinted tile (Clean-Room, plan §3.12): a calendar sheet, a paper plane,
	// an envelope with "@", an envelope with a lock for Proton, a file, a bookmark and a key with
	// code brackets for the own inbox (ADR-0038). No logos of Google, Telegram, Web.de or Proton.
	// Decorative: the name of the channel stands next to it.
	let { kind }: { kind: ChannelIconKind } = $props();
</script>

<span class="channel-icon" aria-hidden="true">
	<svg viewBox="0 0 16 16" width="18" height="18" focusable="false">
		{#if kind === 'calendar'}
			<path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3" />
			<path d="M5 9h1.5M7.25 9h1.5M9.5 9H11M5 11.25h1.5M7.25 11.25h1.5" />
		{:else if kind === 'telegram'}
			<path d="M14 2.5L1.75 7.5l4.5 1.5L14 2.5 8 10.75l.5 3.75 2-3 3.5 1.5z" />
		{:else if kind === 'mail'}
			<path d="M2 4h12v8.5H2z" />
			<path d="M2 4l6 4.75L14 4" />
		{:else if kind === 'proton'}
			<path d="M1.75 4h9.5v6.5h-9.5zM1.75 4l4.75 3.75L11.25 4" />
			<path d="M11 10.25h3.25v3.5H11zM11.75 10.25v-1a.87.87 0 0 1 1.75 0v1" />
		{:else if kind === 'files'}
			<path d="M4 1.75h5l3 3v9.5H4zM9 1.75v3h3M6 8.5h4M6 11h4" />
		{:else if kind === 'api'}
			<path d="M4.5 4L1.75 8l2.75 4M11.5 4l2.75 4-2.75 4" />
			<path d="M6.25 8a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0zM8.75 8h2.5M10.25 8v1.5" />
		{:else}
			<path d="M4 2h8v12l-4-3-4 3z" />
			<path d="M8 5v3.5M6.5 7l1.5 1.5L9.5 7" />
		{/if}
	</svg>
</span>

<style>
	/* Tinted tile: "Marke Fläche / Text darauf", no new colour. */
	.channel-icon {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-control);
	}

	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
