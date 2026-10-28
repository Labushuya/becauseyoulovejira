<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
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
	// In the phone frame (MO-1b, ADR-0073 addendum) every popover is a sheet at the bottom over the
	// full width instead, wherever it was opened: rows of a menu with 44 px, and at its end a visible
	// "Schließen" (a menu entry in a menu, a button in a panel), so closing never needs Escape or a
	// tap beside it. Keys, focus and light dismiss stay those of the popover.
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
		buttonDescribedby,
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
		/** aria-describedby of the button, e.g. the error of the field it chooses for (ADR-0062). */
		buttonDescribedby?: string;
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
	/** In the phone frame the popover stands as a sheet at the bottom, not at its button. */
	const mobileLayout = getMobileLayoutStore();
	const sheet = $derived(mobileLayout.active);
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
		if (sheet) {
			// The sheet stands by its CSS; nothing of a place at the button stays.
			popover.style.top = '';
			popover.style.left = '';
			popover.style.maxHeight = '';
			return;
		}
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

	// Turning the phone or the switch while it is open: from the sheet to the button and back.
	$effect(() => {
		void sheet;
		if (expanded) position();
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
	aria-describedby={buttonDescribedby}
	tabindex={buttonTabindex}
	bind:this={trigger}
	onclick={onbuttonclick}
>
	{@render button()}
</button>
<div
	class="popover"
	class:menu={kind === 'menu'}
	class:sheet
	id={popoverId}
	popover="auto"
	role={kind === 'menu' ? 'menu' : 'dialog'}
	aria-label={label}
	aria-labelledby={labelledby}
	tabindex="-1"
	data-overlay
	data-sheet={sheet ? '' : undefined}
	bind:this={popover}
	{onkeydown}
	{onfocusout}
>
	{#if sheet}
		<!-- The content scrolls alone, "Schließen" stays in view at the end of the sheet. -->
		<div class="sheet-content" class:menu-items={kind === 'menu'}>
			{@render children({ close })}
		</div>
		{#if kind === 'menu'}
			<div role="separator"></div>
			<button class="sheet-close" type="button" role="menuitem" tabindex="-1" onclick={close}>
				Schließen
			</button>
		{:else}
			<div class="sheet-foot">
				<button class="button-secondary" type="button" onclick={close}>Schließen</button>
			</div>
		{/if}
	{:else}
		{@render children({ close })}
	{/if}
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

	/*
	 * A locked entry (aria-disabled, e.g. "Nach oben" at the top of the day plan or "Alle Kanäle jetzt
	 * abrufen" without a connection) is muted on every device (MO-7a, ADR-0073 addendum MO-7a): the
	 * muted text (4.5 : 1 on thick glass, glass-contrast.test.ts, so its name stays readable) and no
	 * accent fill on hover or keyboard focus, so it never looks like a choice. It stays in the menu,
	 * its name says why, the arrow keys still reach it (APG), and the focus ring of base.css shows
	 * where. The pointer says "not allowed", except over a busy entry (aria-busy, ADR-0026).
	 */
	.menu
		:global(
			:is(
				[role='menuitem'],
				[role='menuitemradio'],
				[role='menuitemcheckbox']
			)[aria-disabled='true']
		),
	.menu
		:global(
			:is(
					[role='menuitem'],
					[role='menuitemradio'],
					[role='menuitemcheckbox']
				)[aria-disabled='true']:is(:hover, :focus-visible)
		) {
		color: var(--color-text-muted);
		background: none;
	}

	.menu
		:global(
			:is(
					[role='menuitem'],
					[role='menuitemradio'],
					[role='menuitemcheckbox']
				)[aria-disabled='true']:not([aria-busy='true'])
		) {
		cursor: not-allowed;
	}

	.menu :global([role='separator']) {
		height: 1px;
		margin: 0.25rem 0.5rem;
		background: var(--color-separator);
	}

	/*
	 * Sheet of the phone frame (MO-1b, ADR-0073 addendum): at the bottom over the full width, at
	 * most --sheet-max-height high, with round upper corners and the safe area of the system bar
	 * below. The content scrolls alone, "Schließen" stays at the end. Rows of a menu have 44 px. It
	 * slides up from below; reduced motion shows it at once (base.css).
	 */
	.popover.sheet {
		inset: auto 0 0;
		width: 100%;
		min-width: 0;
		max-width: none;
		max-height: var(--sheet-max-height);
		padding: 0.5rem 0.5rem calc(0.5rem + var(--safe-bottom));
		overflow: hidden;
		border-bottom: none;
		border-radius: var(--radius-overlay) var(--radius-overlay) 0 0;
	}

	.popover.sheet:popover-open {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		animation-name: sheet-in;
	}

	.sheet-content {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}

	.sheet-content.menu-items {
		display: grid;
		gap: 0.125rem;
		align-content: start;
	}

	.sheet.menu :global(:is([role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'])) {
		min-height: var(--control-height-touch);
		padding: 0.5rem 0.75rem;
	}

	.sheet-close {
		flex: none;
		font-weight: 600;
	}

	.sheet-foot {
		display: flex;
		flex: none;
		justify-content: flex-end;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-separator);
	}

	@keyframes sheet-in {
		from {
			transform: translateY(100%);
		}
	}

	@keyframes popover-in {
		from {
			opacity: 0;
			transform: translateY(-0.25rem);
		}
	}
</style>
