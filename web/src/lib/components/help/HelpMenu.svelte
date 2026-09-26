<script lang="ts">
	import { resolve } from '$app/paths';
	import { HELP_KEYSHORTCUTS } from '$lib/domain/shortcuts';
	import Popover from '../overlay/Popover.svelte';

	// Help menu in the header (ADR-0026 section 7, plan EH-9 §3.2): an icon button "?" that opens a
	// menu on the popover building block (kind "menu", like the theme switcher). "Tastaturkürzel"
	// opens the modal of the (app) layout and names its key; "Hilfe öffnen" and "Kanäle einrichten"
	// are links. Every entry closes the menu first, so the focus is back on the button before a
	// modal takes it or the page changes. With `ontour` (EH-13) "Kurze Einführung" starts the guided
	// tour; the focus comes back to the button when the tour ends.
	let { onshortcuts, ontour }: { onshortcuts: () => void; ontour?: () => void } = $props();
</script>

<div class="help-menu">
	<Popover
		kind="menu"
		label="Hilfe"
		placement="bottom-end"
		buttonClass="button-icon"
		buttonLabel="Hilfe"
	>
		{#snippet button()}
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
				<circle cx="8" cy="8" r="6.25" />
				<path d="M6.25 6.25a1.75 1.75 0 1 1 2.6 1.53c-.5.28-.85.7-.85 1.27v.45" />
				<circle class="dot" cx="8" cy="11.4" r="0.5" />
			</svg>
		{/snippet}
		{#snippet children({ close })}
			<button
				class="item"
				type="button"
				role="menuitem"
				tabindex="-1"
				aria-haspopup="dialog"
				aria-keyshortcuts={HELP_KEYSHORTCUTS}
				onclick={() => {
					close();
					onshortcuts();
				}}
			>
				<span>Tastaturkürzel</span>
				<kbd aria-hidden="true">?</kbd>
			</button>
			<a
				class="item"
				role="menuitem"
				tabindex="-1"
				href={resolve('/einstellungen/hilfe')}
				onclick={() => close()}
			>
				Hilfe öffnen
			</a>
			<a
				class="item"
				role="menuitem"
				tabindex="-1"
				href={resolve('/einstellungen/kanaele')}
				onclick={() => close()}
			>
				Kanäle einrichten
			</a>
			{#if ontour}
				<button
					class="item"
					type="button"
					role="menuitem"
					tabindex="-1"
					onclick={() => {
						close();
						ontour();
					}}
				>
					Kurze Einführung
				</button>
			{/if}
		{/snippet}
	</Popover>
</div>

<style>
	.help-menu {
		display: inline-flex;
	}

	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dot {
		fill: currentColor;
		stroke: none;
	}

	.item {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-width: 12rem;
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		text-align: left;
		text-decoration: none;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.item:hover,
	.item:focus-visible {
		background: var(--color-bg);
	}
</style>
