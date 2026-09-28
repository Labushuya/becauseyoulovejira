<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { place, type Placement } from '$lib/overlay/position';

	// Popover building block (ADR-0025 section 5): a button and a native popover="auto" in the top
	// layer. The browser brings light dismiss (click outside, Escape) and "one at a time"; the
	// position comes from place() instead of CSS anchor positioning, so every target browser shows
	// it at the same spot. Two kinds: "menu" (role menu, arrow keys, a choice closes) and "panel"
	// (non-modal dialog with a name, e.g. a fieldset of radios). On opening the focus moves into
	// the popover; Escape and a choice return it to the button, leaving it with Tab closes.
	let {
		kind,
		label,
		labelledby,
		placement = 'bottom-start',
		buttonClass = '',
		buttonLabel,
		button,
		initialFocus,
		onopen,
		returnFocus,
		buttonTitle,
		buttonKeyshortcuts,
		children
	}: {
		kind: 'menu' | 'panel';
		/** Name of the popover; alternatively `labelledby`. */
		label?: string;
		/** ID of the element that names the popover (e.g. the legend of its fieldset). */
		labelledby?: string;
		placement?: Placement;
		buttonClass?: string;
		/** Name of the button when its content is only an icon. */
		buttonLabel?: string;
		/** Content of the button. */
		button: Snippet;
		/** Element that gets the focus on opening; otherwise the checked or first entry. */
		initialFocus?: (popover: HTMLElement) => HTMLElement | null;
		/** Called when the popover opens, before the focus moves in (e.g. to fill a form). */
		onopen?: () => void;
		/**
		 * Where the focus goes on closing instead of the button, e.g. back into the text of the
		 * editor that opened a popover of its toolbar (RT-4).
		 */
		returnFocus?: () => HTMLElement | null;
		/** Tooltip of the button, e.g. with its shortcut. */
		buttonTitle?: string;
		/** aria-keyshortcuts of the button. */
		buttonKeyshortcuts?: string;
		/** Content; `close` hides the popover and returns the focus to the button. */
		children: Snippet<[{ close: () => void }]>;
	} = $props();

	const uid = $props.id();
	const popoverId = `${uid}-popover`;
	const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
	const FOCUSABLE =
		'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

	let trigger = $state<HTMLButtonElement>();
	let popover = $state<HTMLElement>();
	let expanded = $state(false);

	function items(): HTMLElement[] {
		return popover ? [...popover.querySelectorAll<HTMLElement>(MENU_ITEMS)] : [];
	}

	function position() {
		if (!popover || !trigger) return;
		const at = place(
			trigger.getBoundingClientRect(),
			{ width: popover.offsetWidth, height: popover.scrollHeight },
			{ width: window.innerWidth, height: window.innerHeight },
			placement
		);
		popover.style.top = `${at.top}px`;
		popover.style.left = `${at.left}px`;
		popover.style.maxHeight = `${at.maxHeight}px`;
	}

	function focusInside() {
		if (!popover) return;
		const target =
			initialFocus?.(popover) ??
			(kind === 'menu'
				? (items().find((item) => item.getAttribute('aria-checked') === 'true') ?? items()[0])
				: (popover.querySelector<HTMLElement>('input:checked') ??
					popover.querySelector<HTMLElement>(FOCUSABLE)));
		(target ?? popover).focus();
	}

	/** Hides the popover; `focusBack` puts the focus back on the button (or `returnFocus`). */
	function hide(focusBack: boolean) {
		if (popover && expanded && typeof popover.hidePopover === 'function') popover.hidePopover();
		if (focusBack) (returnFocus?.() ?? trigger)?.focus();
	}

	const close = () => hide(true);

	/** Opens the popover by code, as a click on the button would (e.g. Ctrl+K in the editor). */
	export function open(): void {
		if (popover && !expanded && typeof popover.showPopover === 'function') popover.showPopover();
	}

	// aria-expanded follows the toggle event explicitly: not every browser (and not jsdom) derives
	// it from popovertarget. While open, the popover follows resizing and scrolling.
	$effect(() => {
		const element = popover;
		if (!element) return;
		const onbeforetoggle = (event: Event) => {
			// Hidden until placed, so it never flashes at the default position of the browser.
			if ((event as ToggleEvent).newState === 'open') element.style.visibility = 'hidden';
		};
		const ontoggle = (event: Event) => {
			expanded = (event as ToggleEvent).newState === 'open';
			if (!expanded) return;
			onopen?.();
			position();
			element.style.visibility = '';
			void tick().then(focusInside);
		};
		element.addEventListener('beforetoggle', onbeforetoggle);
		element.addEventListener('toggle', ontoggle);
		return () => {
			element.removeEventListener('beforetoggle', onbeforetoggle);
			element.removeEventListener('toggle', ontoggle);
		};
	});

	$effect(() => {
		if (!expanded) return;
		const update = () => position();
		window.addEventListener('resize', update, { passive: true });
		window.addEventListener('scroll', update, { passive: true, capture: true });
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, { capture: true });
		};
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			// The innermost overlay wins (ADR-0025 section 1): nothing behind reacts to this Escape.
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (kind !== 'menu') return;
		if (event.key === 'Tab') {
			hide(false);
			return;
		}
		const list = items();
		if (list.length === 0) return;
		const index = list.indexOf(document.activeElement as HTMLElement);
		const next: Record<string, number> = {
			ArrowDown: (index + 1) % list.length,
			ArrowUp: (index - 1 + list.length) % list.length,
			Home: 0,
			End: list.length - 1
		};
		const target = next[event.key];
		if (target === undefined) return;
		event.preventDefault();
		list[target]?.focus();
	}

	/** Leaving the popover with the focus closes it; the button toggles it by itself. */
	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || popover?.contains(next) || trigger?.contains(next)) return;
		hide(false);
	}
</script>

<button
	class={buttonClass}
	type="button"
	popovertarget={popoverId}
	aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'}
	aria-expanded={expanded}
	aria-controls={popoverId}
	aria-label={buttonLabel}
	title={buttonTitle}
	aria-keyshortcuts={buttonKeyshortcuts}
	bind:this={trigger}
>
	{@render button()}
</button>
<div
	class="popover"
	class:menu={kind === 'menu'}
	id={popoverId}
	popover="auto"
	role={kind === 'menu' ? 'menu' : 'dialog'}
	aria-label={label}
	aria-labelledby={labelledby}
	tabindex="-1"
	data-overlay
	bind:this={popover}
	{onkeydown}
	{onfocusout}
>
	{@render children({ close })}
</div>

<style>
	/*
	 * Thick glass of the control layer (ADR-0029 sections 1 and 2): translucent surface with blur, a
	 * line on glass, the light edge inside at the top and the neutral popover shadow. The content is
	 * no further glass: controls inside use surfaces or fills, never an own backdrop-filter.
	 */
	.popover {
		position: fixed;
		inset: auto;
		margin: 0;
		min-width: 11rem;
		padding: 0.375rem;
		overflow: auto;
		color: var(--color-text);
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border: 1px solid var(--color-separator);
		border-radius: var(--radius-overlay);
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			var(--shadow-popover);
	}

	.popover:popover-open {
		animation: popover-in var(--motion-fast) var(--motion-ease);
	}

	.menu:popover-open {
		display: grid;
		gap: 0.125rem;
	}

	/*
	 * Menu rows in the macOS style (ADR-0029 section 5), the same in every menu: hover and keyboard
	 * focus fill the row with the accent and the color on it. The focus ring stays in addition,
	 * because the fill does not reach 3 : 1 against glass in every dark theme. The chosen entry keeps
	 * its check mark and weight (never color alone).
	 */
	.menu :global(:is([role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'])) {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 1.5rem;
		padding: 0.25rem 0.5rem;
		font-size: var(--font-size-body);
		color: var(--color-text);
		text-align: left;
		text-decoration: none;
		background: none;
		border: none;
		border-radius: var(--radius-item);
		cursor: pointer;
	}

	.menu
		:global(
			:is([role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']):is(
				:hover,
				:focus-visible
			)
		) {
		color: var(--color-on-brand);
		background: var(--color-brand);
	}

	.menu :global([role='separator']) {
		height: 1px;
		margin: 0.25rem 0.5rem;
		background: var(--color-separator);
	}

	@keyframes popover-in {
		from {
			opacity: 0;
			transform: translateY(-0.25rem);
		}
	}
</style>
