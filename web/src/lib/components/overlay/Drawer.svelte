<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { getPanelHost } from '$lib/overlay/panel-host.svelte';

	// Side panel building block (ADR-0025 section 6; plan UI-Konsistenz, package UI-6): right of the
	// view, 480 px. A fixed header with the context on the left and on the right the actions,
	// "Vollansicht" (a link, so a middle click opens a tab; only with `fullViewHref`) and the ×
	// "Panel schließen"; a content area that scrolls alone and an optional fixed footer. One Escape rule for every panel: Escape closes unless something inside
	// consumed it (a field in edit mode, the tag picker, a dialog). In detail panels the form fields
	// keep Escape, in form panels ("Neues Ticket", "Erfassen") it means "Abbrechen" from anywhere.
	// ViewWithPanel places it (embedded column from 64rem, overlay below) and slides it in only when
	// it opens; a click on its blanket closes like the × (package UI-6b).
	// In the phone frame (MO-4, ADR-0073 addendum MO-4) every panel is a page over the whole screen:
	// the head starts with an arrow back (`backLabel`, `onback`, else the way of the ×) and holds no ×
	// and no "Vollansicht", which on the phone would show the same parts once more; margins of the
	// page (--page-inline). Off, or from 40rem, the head stays as it is.
	let {
		labelledby,
		onclose,
		backLabel = 'Zurück',
		onback,
		closeFromFields = false,
		fullViewHref = null,
		onfullview,
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
		/** Name of the arrow back in the phone frame, e.g. "Zur Liste". */
		backLabel?: string;
		/** The arrow back in the phone frame; without it the way of the ×. */
		onback?: () => void;
		/** Form panels: Escape closes also from input fields. */
		closeFromFields?: boolean;
		/** Address of the full view (UI-7); without it there is no link. */
		fullViewHref?: ResolvedPathname | null;
		/** A click on "Vollansicht" (the owner remembers the choice, plan BI-1). */
		onfullview?: () => void;
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
	const mobileLayout = getMobileLayoutStore();
	/** The phone frame applies: the panel is a page with the arrow back. */
	const framed = $derived(mobileLayout.active);

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
		{#if framed}
			<button
				class="button-icon back"
				type="button"
				aria-label={backLabel}
				title={backLabel}
				data-panel-back
				onclick={() => (onback ?? onclose)()}
			>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path d="M13 8H3M7.5 3.5L3 8l4.5 4.5" />
				</svg>
			</button>
		{/if}
		<div class="context">{@render context?.()}</div>
		<div class="head-actions">
			{@render actions?.()}
			{#if fullViewHref && !framed}
				<a
					class="button-icon"
					href={fullViewHref}
					aria-label="Vollansicht öffnen"
					title="Vollansicht"
					data-full-view-link
					onclick={(event) => {
						// Opening it in a new tab or window is no choice for this one.
						if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onfullview?.();
					}}
				>
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
						<path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
					</svg>
				</a>
			{/if}
			{#if !framed}
				<button class="button-icon" type="button" aria-label="Panel schließen" onclick={onclose}>
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			{/if}
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

	.head-actions svg,
	.back svg {
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

	/*
	 * Phone frame (MO-4, ADR-0073 addendum MO-4): a page over the whole screen. The arrow back stands
	 * at the start of the head, the context fills the middle, the actions keep the end; all targets
	 * have 44 px from base.css. No line at the left edge, the margins of the page.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .drawer {
			border-left: none;
		}

		:global(:root[data-mobile-layout='on']) .head {
			gap: 0.25rem;
			padding: 0.25rem;
		}

		:global(:root[data-mobile-layout='on']) .context {
			flex: 1;
		}

		:global(:root[data-mobile-layout='on']) .body {
			padding: 1rem var(--page-inline) 1.5rem;
		}

		:global(:root[data-mobile-layout='on']) .foot {
			padding: 0.5rem var(--page-inline);
		}
	}
</style>
