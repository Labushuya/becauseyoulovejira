<script lang="ts">
	import type { Snippet } from 'svelte';

	// List with the side panel next to it (ADR-0025 section 6; plan UI-Konsistenz, package UI-6),
	// shared by tickets and inbox instead of two copied grids. From 48rem the panel is a column of
	// --drawer-width right of the list; below it lies over the list, which is then inert (not
	// reachable by keyboard or screen reader). The panel slides in only when it opens next to the
	// list, not when it changes to another entry (data-entering for the Drawer).
	let {
		withPanel,
		list,
		children
	}: {
		/** A panel route is shown (ticket, entry, "Neues Ticket", "Erfassen"). */
		withPanel: boolean;
		list: Snippet;
		/** The route content: the panel, or nothing on the list alone. */
		children: Snippet;
	} = $props();

	const NARROW = '(max-width: 47.99rem)';

	let narrow = $state(false);
	let entering = $state(false);
	let wasOpen = false;

	$effect(() => {
		if (typeof window.matchMedia !== 'function') return;
		const query = window.matchMedia(NARROW);
		const update = () => {
			narrow = query.matches;
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
</script>

<div class="view" class:with-panel={withPanel}>
	<div class="list" inert={withPanel && narrow}>
		{@render list()}
	</div>
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

	.panel:not(.open) {
		display: none;
	}

	@media (min-width: 48rem) {
		.with-panel {
			grid-template-columns: minmax(0, 1fr) var(--drawer-width);
		}

		.with-panel .panel {
			position: sticky;
			top: 1rem;
		}
	}
</style>
