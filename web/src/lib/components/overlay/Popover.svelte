<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import {
		place,
		placeAtPoint,
		type Placement,
		type Position,
		type VirtualAnchor
	} from '$lib/overlay/position';

	// Popover building block (ADR-0025 section 5): a button and a native popover="auto" in the top
	// layer. The browser brings light dismiss (click outside, Escape) and "one at a time"; the
	// position comes from place() instead of CSS anchor positioning, so every target browser shows
	// it at the same spot. Two kinds: "menu" (role menu, arrow keys, a choice closes) and "panel"
	// (non-modal dialog with a name, e.g. a fieldset of radios). On opening the focus moves into
	// the popover; Escape and a choice return it to the button, leaving it with Tab closes.
	// Opened by code (`open`), it may stand at a virtual anchor instead (plan aktionsmenues, AM-3):
	// at the pointer of a right click (placeAtPoint) or below another element; the focus then goes
	// back to the element that had it before, if there was one.
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
		buttonTabindex,
		trigger = $bindable(),
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
		/**
		 * -1 takes the button out of the order of Tab, e.g. in a cell of the calendar grid, which the
		 * arrow keys reach (ADR-0053 §8); default: the order of the document.
		 */
		buttonTabindex?: -1;
		/** The button, e.g. for the focus after an area the menu opened closes (plan AM). */
		trigger?: HTMLButtonElement;
		/** Content; `close` hides the popover and returns the focus to the button. */
		children: Snippet<[{ close: () => void }]>;
	} = $props();

	const uid = $props.id();
	const popoverId = `${uid}-popover`;
	const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
	const FOCUSABLE =
		'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

	let popover = $state<HTMLElement>();
	let expanded = $state(false);
	/**
	 * Where `open` put the popover instead of below the button: the pointer, kept as its distance
	 * to the button so the popover follows its row while the page scrolls, or another element.
	 * A click on the button opens it at the button again.
	 */
	let anchor: { dx: number; dy: number } | { element: HTMLElement } | null = null;
	/** The element focused before `open`; the focus goes back there instead of the button. */
	let returnTarget: HTMLElement | null = null;

	function items(): HTMLElement[] {
		return popover ? [...popover.querySelectorAll<HTMLElement>(MENU_ITEMS)] : [];
	}

	function position() {
		if (!popover || !trigger) return;
		const size = { width: popover.offsetWidth, height: popover.scrollHeight };
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		let at: Position;
		if (anchor !== null && 'dx' in anchor) {
			const button = trigger.getBoundingClientRect();
			at = placeAtPoint({ x: button.left + anchor.dx, y: button.top + anchor.dy }, size, viewport);
		} else if (anchor !== null && anchor.element.isConnected) {
			at = place(anchor.element.getBoundingClientRect(), size, viewport, 'bottom-start');
		} else {
			at = place(trigger.getBoundingClientRect(), size, viewport, placement);
		}
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

	/**
	 * Hides the popover; `focusBack` puts the focus back on the element focused before `open`, the
	 * button or `returnFocus`.
	 */
	function hide(focusBack: boolean) {
		const before = returnTarget?.isConnected ? returnTarget : null;
		returnTarget = null;
		if (popover && expanded && typeof popover.hidePopover === 'function') popover.hidePopover();
		if (focusBack) (before ?? returnFocus?.() ?? trigger)?.focus();
	}

	const close = () => hide(true);

	/**
	 * Opens the popover by code, as a click on the button would (e.g. Ctrl+K in the editor), or at
	 * `at` (a right click, Shift+F10; AM-3). Open already, it moves there. `returnTo` gets the focus
	 * back when it closes.
	 */
	export function open(at: VirtualAnchor | null = null, returnTo: HTMLElement | null = null): void {
		if (!popover || !trigger) return;
		if (at !== null && 'point' in at) {
			const button = trigger.getBoundingClientRect();
			anchor = { dx: at.point.x - button.left, dy: at.point.y - button.top };
		} else {
			anchor = at;
		}
		returnTarget = returnTo;
		if (expanded) position();
		else if (typeof popover.showPopover === 'function') popover.showPopover();
	}

	/** A click on the button opens the popover at the button, whatever `open` chose before. */
	function onbuttonclick() {
		anchor = null;
		returnTarget = null;
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
	tabindex={buttonTabindex}
	bind:this={trigger}
	onclick={onbuttonclick}
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
		/*
		 * Long entries ("Haus › Garten (GART)") wrap instead of leaving the viewport (VIEWPORT_MARGIN),
		 * even in a table cell with white-space: nowrap, where the popovers of the cells live.
		 */
		max-width: calc(100vw - 1rem);
		padding: 0.375rem;
		white-space: normal;
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
