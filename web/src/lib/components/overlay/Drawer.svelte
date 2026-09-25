<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';

	// Side panel building block (ADR-0025 section 6; plan UI-Konsistenz, package UI-6): not modal,
	// right of the list (ViewWithPanel places it), 480 px. A fixed header with the context on the
	// left and on the right the actions, "Vollansicht" (a link, so a middle click opens a tab; only
	// with `fullViewHref`) and the × "Panel schließen"; a content area that scrolls alone and an
	// optional fixed footer. One Escape rule for every panel: Escape closes unless something inside
	// consumed it (a field in edit mode, the tag picker, a dialog). In detail panels the form fields
	// keep Escape, in form panels ("Neues Ticket", "Erfassen") it means "Abbrechen" from anywhere.
	// The slide-in comes from ViewWithPanel, only when the panel opens next to the list.
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
	.drawer {
		display: flex;
		flex-direction: column;
		min-width: 0;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* Next to the list (ViewWithPanel keeps its column in view): header and footer stand. */
	@media (min-width: 48rem) {
		.drawer {
			max-height: calc(100dvh - 2rem);
		}
	}

	/* Narrow: over the list, which ViewWithPanel makes inert. */
	@media (max-width: 47.99rem) {
		.drawer {
			position: fixed;
			inset: 0;
			z-index: 10;
			border: none;
			border-radius: 0;
		}
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
		border-bottom: 1px solid var(--color-line);
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

	.body {
		display: grid;
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
		border-top: 1px solid var(--color-line);
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
