<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { getPanelHost } from '$lib/overlay/panel-host.svelte';

	// Side panel building block (ADR-0025 section 6; plan UI-Konsistenz, package UI-6): right of the
	// view, 480 px. A fixed header with the context on the left and on the right the actions,
	// "Vollansicht" (a link, so a middle click opens a tab; only with `fullViewHref`) and the ×
	// "Panel schließen"; a content area that scrolls alone and an optional fixed footer. One Escape rule for every panel: Escape closes unless something inside
	// consumed it (a field in edit mode, the tag picker, a dialog). In detail panels the form fields
	// keep Escape, in form panels ("Neues Ticket", "Erfassen") it means "Abbrechen" from anywhere.
	// ViewWithPanel places it (embedded column from 64rem, overlay below) and slides it in only when
	// it opens; a click on its blanket closes like the × (package UI-6b).
	let {
		labelledby,
		onclose,
		closeFromFields = false,
		fullViewHref = null,
		onkeydown: onpanelkeydown,
		context,
		actions,
		footer,
		children
	}: {
		/** ID of the heading of the content (the title of the ticket or entry). */
		labelledby: string;
		/** × and Escape: back to the list (the owner navigates, and asks first if needed). */
		onclose: () => void;
		/** Form panels: Escape closes also from input fields. */
		closeFromFields?: boolean;
		/** Address of the full view (UI-7); without it there is no link. */
		fullViewHref?: ResolvedPathname | null;
		/** Keys of the panel before the Escape rule (e.g. Ctrl+Enter saves a form). */
		onkeydown?: (event: KeyboardEvent) => void;
		/** Left part of the header: key, "Eintrag im Eingang", … */
		context?: Snippet;
		/** Actions of the header right before "Vollansicht" and ×, e.g. "Löschen …". */
		actions?: Snippet;
		/** Fixed footer, e.g. the buttons of a form or the actions of an entry. */
		footer?: Snippet;
		children: Snippet;
	} = $props();

	const host = getPanelHost();

	// The blanket of the overlay (below 64rem) closes the shown panel like its ×.
	$effect(() => host?.register(() => onclose()));

	function isFormField(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	function onkeydown(event: KeyboardEvent) {
		onpanelkeydown?.(event);
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (!closeFromFields && isFormField(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		onclose();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="drawer" aria-labelledby={labelledby} data-overlay {onkeydown}>
	<header class="head">
		<div class="context">{@render context?.()}</div>
		<div class="head-actions">
			{@render actions?.()}
			{#if fullViewHref}
				<a
					class="button-icon"
					href={fullViewHref}
					aria-label="Vollansicht öffnen"
					title="Vollansicht"
					data-full-view-link
				>
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
						<path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
					</svg>
				</a>
			{/if}
			<button class="button-icon" type="button" aria-label="Panel schließen" onclick={onclose}>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
	</header>
	<div class="body">
		{@render children()}
	</div>
	{#if footer}
		<footer class="foot">
			{@render footer()}
		</footer>
	{/if}
</aside>

<style>
	/*
	 * Fills its column, from below the header to the bottom of the window, or the overlay of
	 * ViewWithPanel (--drawer-width wide); header and footer stand. A line at the left instead of a
	 * framed box, like the side panel of Jira. Glass of the control layer (ADR-0029 section 1):
	 * embedded in its column only the page background lies behind it (regular); as the overlay
	 * of ViewWithPanel it floats over the blanket and the view (thick). Lines on glass in
	 * --color-separator, no shadow: the line and, as overlay, the blanket set it apart. No fixed
	 * descendants (glass-allowlist.test.ts), the blur would be their containing block; popovers live
	 * in the top layer.
	 */
	.drawer {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		color: var(--color-text);
		background: var(--material-regular);
		backdrop-filter: var(--glass-filter-regular);
		border-left: 1px solid var(--color-separator);
	}

	:global([data-panel-mode='overlay']) .drawer {
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
	}

	.head,
	.foot {
		flex: none;
	}

	.head {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.5rem 0.5rem 1.25rem;
		border-bottom: 1px solid var(--color-separator);
	}

	.context {
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.head-actions {
		display: flex;
		flex: none;
		gap: 0.25rem;
		align-items: center;
	}

	.head-actions svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* One column that may shrink: long words, code and fields never push the panel wider. */
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		align-content: start;
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem 1.25rem 1.5rem;
		overflow-y: auto;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: flex-end;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid var(--color-separator);
	}

	/* The primary button of the footer has the size of the secondary ones. */
	.foot :global(.button-primary) {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	/* Slide-in only when the panel opens next to the list (ViewWithPanel sets data-entering). */
	:global([data-entering]) .drawer {
		animation: drawer-in var(--motion-medium) var(--motion-ease);
	}

	@keyframes drawer-in {
		from {
			opacity: 0;
			transform: translateX(1.5rem);
		}
	}
</style>
