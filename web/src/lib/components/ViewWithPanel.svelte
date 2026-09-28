<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		PANEL_EMBEDDED_QUERY,
		PanelHost,
		getPanelShell,
		setPanelHost
	} from '$lib/overlay/panel-host.svelte';

	// A view with the side panel (ADR-0025 section 6; plan UI-Konsistenz, packages UI-6 and UI-6b),
	// shared by tickets and inbox instead of two copied grids. Like the side panel of Jira:
	// - from 64rem the panel is embedded as a full column of --drawer-width right of the whole view
	//   (tiles, filters, section bar and table), from below the header to the bottom of the window;
	//   the view becomes narrower and its tables hide columns instead of scrolling sideways;
	// - below 64rem it lies over the view from the right (480 px, below 36rem the full width) with
	//   the blanket behind it; the view and the header are inert, and a click on the blanket closes
	//   like the × of the panel.
	// The panel slides in only when it opens, not when it changes to another entry (data-entering
	// for the Drawer).
	let {
		withPanel,
		list,
		children
	}: {
		/** A panel route is shown (ticket, entry, "Neues Ticket", "Erfassen"). */
		withPanel: boolean;
		/** The view: tiles, filters, section bar and table. */
		list: Snippet;
		/** The route content: the panel, or nothing on the list alone. */
		children: Snippet;
	} = $props();

	const host = setPanelHost(new PanelHost());
	const shell = getPanelShell();

	/** Wide enough for the embedded panel; without matchMedia (tests) the panel is embedded. */
	let wide = $state(true);
	let entering = $state(false);
	let wasOpen = false;

	/** The panel lies over the view, which is then not reachable. */
	const covering = $derived(withPanel && !wide);

	$effect(() => {
		if (typeof window.matchMedia !== 'function') return;
		const query = window.matchMedia(PANEL_EMBEDDED_QUERY);
		const update = () => {
			wide = query.matches;
		};
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	$effect(() => {
		const open = withPanel;
		if (open && !wasOpen) entering = true;
		if (!open) entering = false;
		wasOpen = open;
	});

	// The header of the app belongs to the covered view as well.
	$effect(() => {
		if (shell === undefined) return;
		shell.covering = covering;
		return () => {
			shell.covering = false;
		};
	});
</script>

<div
	class="view"
	class:with-panel={withPanel}
	class:covering
	data-panel-mode={withPanel ? (covering ? 'overlay' : 'embedded') : undefined}
>
	<div class="list" inert={covering}>
		{@render list()}
	</div>
	{#if covering}
		<!-- Pointer only: Escape and the × of the panel close for the keyboard. -->
		<div class="blanket" aria-hidden="true" data-overlay onclick={() => host.close()}></div>
	{/if}
	<div
		class="panel"
		class:open={withPanel}
		data-entering={entering ? '' : undefined}
		onanimationend={() => (entering = false)}
	>
		{@render children()}
	</div>
</div>

<style>
	.view {
		display: grid;
		gap: 1.5rem;
		align-items: start;
	}

	.list {
		min-width: 0;
	}

	.panel {
		min-width: 0;
	}

	/*
	 * Without a panel the route content takes no room, but it still renders: the full view of a
	 * ticket is a modal in the top layer and replaces the panel (plan BI-1), and a dialog below an
	 * ancestor with display: none would not show.
	 */
	.panel:not(.open) {
		display: contents;
	}

	/*
	 * Embedded: a full column right of the whole view. It reaches over the padding of the main area
	 * (--content-padding of the app layout) to the edges of the window and stands below the sticky
	 * header (--app-header-height, measured by AppHeader), so header and footer of the panel stay
	 * in view while the list scrolls.
	 */
	@media (min-width: 64rem) {
		.with-panel {
			grid-template-columns: minmax(0, 1fr) var(--drawer-width);
			margin-block: calc(-1 * var(--content-padding, 0px));
			margin-right: calc(-1 * var(--content-padding, 0px));
		}

		.with-panel .list {
			padding-block: var(--content-padding, 0px);
		}

		.with-panel .panel {
			position: sticky;
			top: var(--app-header-height, 0px);
			height: calc(100dvh - var(--app-header-height, 0px));
		}
	}

	/* Overlay: from the right over the view and the header, the blanket behind it. */
	.covering .panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 11;
		width: min(var(--drawer-width), 100%);
	}

	.blanket {
		position: fixed;
		inset: 0;
		z-index: 10;
		background: var(--color-blanket);
		animation: blanket-in var(--motion-medium) var(--motion-ease);
	}

	/* Below 36rem the panel takes the full width; the blanket is hidden behind it. */
	@media (max-width: 35.99rem) {
		.covering .panel {
			width: 100%;
		}
	}

	@keyframes blanket-in {
		from {
			opacity: 0;
		}
	}
</style>
