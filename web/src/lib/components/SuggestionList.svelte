<script lang="ts">
	import type { Snippet } from 'svelte';
	import { place, type Rect } from '$lib/overlay/position';

	// List of suggestions in the top layer (ADR-0025 section 5, package UI-9), shared by the
	// TagPicker and the "/" menu of the editor (plan editor section 3.2): a listbox as
	// popover="manual", opened and closed by code, placed below its anchor by place() (the input,
	// or the caret in the editor) and following scrolling and resizing, so a scrolling panel or a
	// modal does not cut it off. The focus stays in the field that owns it (aria-activedescendant);
	// the owner renders the options (li role="option" with the class "option", "active" for the
	// highlighted one) and handles the keys. Thick glass like the menus (ADR-0029 section 2).
	let {
		id,
		label,
		open,
		anchor,
		width = 'anchor',
		maxHeight = 192,
		revision,
		children
	}: {
		id: string;
		label: string;
		/** Shown while true. */
		open: boolean;
		/** Where the list sits below (viewport coordinates), or null. */
		anchor: () => (Rect & { width?: number }) | null;
		/** The width of the anchor, or a fixed width in CSS pixels. */
		width?: 'anchor' | number;
		/** Highest list in CSS pixels (12rem as in the flow of a panel before). */
		maxHeight?: number;
		/** Changes whenever the options change, so the list is placed again. */
		revision?: unknown;
		children: Snippet;
	} = $props();

	let list = $state<HTMLElement>();

	function position() {
		const at = anchor();
		if (!list || at === null) return;
		const listWidth = width === 'anchor' ? (at.width ?? at.right - at.left) : width;
		const spot = place(
			at,
			{ width: listWidth, height: Math.min(list.scrollHeight, maxHeight) },
			{ width: window.innerWidth, height: window.innerHeight },
			'bottom-start'
		);
		list.style.top = `${spot.top}px`;
		list.style.left = `${spot.left}px`;
		list.style.width = `${listWidth}px`;
		list.style.maxHeight = `${Math.min(spot.maxHeight, maxHeight)}px`;
	}

	// Shows the list in the top layer while it is open, and keeps it at its anchor while the page
	// or the panel scrolls.
	$effect(() => {
		const element = list;
		if (!element || !open || typeof element.showPopover !== 'function') return;
		element.showPopover();
		position();
		const update = () => position();
		window.addEventListener('resize', update, { passive: true });
		window.addEventListener('scroll', update, { passive: true, capture: true });
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, { capture: true });
			if (element.matches(':popover-open')) element.hidePopover();
		};
	});

	// Other options change the height of the list; it stays below (or above) the anchor.
	$effect(() => {
		void revision;
		if (open) position();
	});
</script>

<ul
	class="suggestion-list"
	{id}
	role="listbox"
	aria-label={label}
	popover="manual"
	hidden={!open}
	data-overlay
	bind:this={list}
>
	{@render children()}
</ul>

<style>
	/* In the top layer, placed by position(); the surface of the popovers. */
	.suggestion-list {
		position: fixed;
		inset: auto;
		margin: 0;
		max-height: 12rem;
		overflow-y: auto;
		padding: 0.25rem 0;
		list-style: none;
		color: var(--color-text);
		/* Thick glass like the menus of Popover (ADR-0029 section 1). */
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border: 1px solid var(--color-separator);
		border-radius: var(--radius-overlay);
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			var(--shadow-popover);
	}

	.suggestion-list:popover-open {
		animation: list-in var(--motion-fast) var(--motion-ease);
	}

	@keyframes list-in {
		from {
			opacity: 0;
		}
	}

	.suggestion-list :global(.option) {
		padding: 0.25rem 0.625rem;
		font-size: var(--font-size-control);
		cursor: pointer;
	}

	/* Active option: colour plus a bar at its start (a second, non-colour mark). */
	.suggestion-list :global(.option.active) {
		background: var(--color-brand-soft-bg);
		box-shadow: inset 3px 0 0 var(--color-brand);
	}
</style>
