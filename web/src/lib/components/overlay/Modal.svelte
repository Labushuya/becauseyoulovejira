<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { modalPlacement } from '$lib/domain/phone-layout';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { closeAction, type CloseTrigger } from '$lib/overlay/close-rules';
	import { flagOutlets } from '$lib/overlay/flag-outlets.svelte';
	import {
		enclosingModal,
		provideModalContext,
		reportNestedModal
	} from '$lib/overlay/modal-context';
	import { findFlagStore } from '$lib/stores/flags.svelte';
	import { registerUnsavedInput } from '$lib/unsaved-input';
	import FlagGroup from './FlagGroup.svelte';

	// Modal building block (ADR-0025 section 3): a native <dialog> with showModal() for top layer,
	// focus trap and inert background. Header with the title and the mandatory ×, a content area
	// that scrolls alone, a fixed footer. ×, Escape, "Abbrechen" and a click on the veil ask the
	// closing rules (close-rules.ts): unsaved input first shows the question "Änderungen
	// verwerfen?" in place of the footer (no dialog from a dialog), a running action blocks every
	// way. The owner decides about `open`; `onclose` only asks for it. The focus goes to the first
	// control of the content on opening and back to the element that had it on closing.
	// No dialog from a dialog (ADR-0025 section 3, addendum 16): the modal marks the components below
	// it (modal-context.ts), so they show forms and questions inline; a modal that opens inside
	// another one anyway is reported (thrown in tests, logged in the app).
	// Flags in front of the modal (ADR-0025 section 8, addendum 18, FL-1): everything outside of a
	// modal <dialog> is inert, so while it is open and the topmost one, the flags of the app render
	// in it, as a direct child of the <dialog> after the frame. The glass, the line, the shadow and
	// the animation lie on the frame, not on the <dialog>, so the <dialog> is no containing block
	// for their position: fixed, and they stand bottom left in the window as usual.
	// Sheet (MO-1a, ADR-0073): the same modal with `placement="sheet"` stands at the bottom over the
	// full width, with round upper corners and the safe area of the system bar below its content, as
	// a sheet of the phone frame ("Mehr"); size, rules, focus and flags stay those of the modal.
	// In the phone frame (MO-1b, ADR-0073 addendum) every modal decides it here, not its owner
	// (modalPlacement): S and M stand as a sheet, L and XL as a page over the whole screen. While it
	// is open with unsaved input, leaving the page in the frame asks first (unsaved-input.ts).
	let {
		open,
		size = 'm',
		placement = 'center',
		title,
		describedBy,
		busy = false,
		dirty = false,
		initialFocus,
		discardQuestion = 'Änderungen verwerfen?',
		discardText = 'Der nicht gespeicherte Text geht verloren.',
		onclose,
		onbusyescape,
		titleLead,
		headerActions,
		footer,
		children
	}: {
		open: boolean;
		size?: 's' | 'm' | 'l' | 'xl';
		/** In the middle of the window, or a sheet at the bottom over the full width (phone frame). */
		placement?: 'center' | 'sheet';
		/** Visible title, names the dialog. */
		title: string;
		/** ID of the element that describes the dialog. */
		describedBy?: string;
		/** An action runs: nothing closes, aria-busy is set. */
		busy?: boolean;
		/** Unsaved input: closing asks first, a click on the veil does nothing. */
		dirty?: boolean;
		/** Element that gets the focus on opening; otherwise the first control of the content. */
		initialFocus?: HTMLElement | null;
		discardQuestion?: string;
		discardText?: string;
		/** The modal asks its owner to close, with the way the user chose. */
		onclose: (reason: CloseTrigger) => void;
		/**
		 * Escape while busy: the owner's own rule ("Gesammelt umwandeln" stops after the current
		 * entry). Without it Escape does nothing while busy.
		 */
		onbusyescape?: () => void;
		/**
		 * A mark before the title, outside of the name of the dialog (the color of the ticket in the
		 * full view, ADR-0052).
		 */
		titleLead?: Snippet;
		headerActions?: Snippet;
		/** Buttons of the footer; `close` is "Abbrechen"/"Schließen" under the closing rules. */
		footer?: Snippet<[{ close: () => void }]>;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const discardId = `${uid}-discard`;

	/** The phone frame decides where the modal stands; on the PC its owner does. */
	const mobileLayout = getMobileLayoutStore();
	const shownAs = $derived(modalPlacement(size, placement, mobileLayout.active));

	// Typed input in an open modal counts as unsaved for leaving the page (MO-1b).
	$effect(() => registerUnsavedInput(() => open && dirty));

	/** The flags of the app (null outside of the app layout, e.g. tests of a single component). */
	const flags = findFlagStore();
	/** This modal in the stack of flag-outlets. */
	const host = Symbol('modal');

	/** Open and on top: the flags render here from now on. */
	function holdFlags() {
		if (flags !== null) flagOutlets.enter(host, flags);
	}

	/** The modal this one renders in, if any: then it must not open (ADR-0025 section 3). */
	const outer = enclosingModal();
	provideModalContext({
		get title() {
			return title;
		}
	});
	/** A nested opening was reported already (at mounting open); the next opening reports again. */
	let nestedReported = false;
	if (outer !== null && untrack(() => open)) {
		nestedReported = true;
		reportNestedModal(
			untrack(() => title),
			outer.title
		);
	}
	const FOCUSABLE =
		'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

	let dialog = $state<HTMLDialogElement>();
	let body = $state<HTMLElement>();
	let foot = $state<HTMLElement>();
	let closeButton = $state<HTMLButtonElement>();
	let keepButton = $state<HTMLButtonElement>();
	let asking = $state(false);
	/** Way the user chose before the question; "Verwerfen" closes with it. */
	let askedBy: CloseTrigger = 'cancel';
	let returnTarget: HTMLElement | null = null;
	let focusBeforeAsking: HTMLElement | null = null;
	let pressedOnVeil = false;

	function first(container: HTMLElement | undefined): HTMLElement | null {
		return container?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
	}

	function activeElement(): HTMLElement | null {
		const active = document.activeElement;
		return active instanceof HTMLElement && active !== document.body ? active : null;
	}

	function focusInitial() {
		(initialFocus ?? first(body) ?? first(foot) ?? closeButton)?.focus();
	}

	/**
	 * Back to the element that had the focus; if it is gone (a deleted row, a removed button), to
	 * the heading of the view (SectionBar, data-view-heading), never to the body.
	 */
	function restoreFocus() {
		const target = returnTarget;
		returnTarget = null;
		if (target === null) return;
		if (target.isConnected) target.focus();
		else document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
	}

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		if (open && !element.open) {
			if (outer !== null && !nestedReported) untrack(() => reportNestedModal(title, outer.title));
			nestedReported = false;
			returnTarget = activeElement();
			asking = false;
			element.showModal();
			holdFlags();
			void tick().then(focusInitial);
		} else if (!open && element.open) {
			element.close();
			flagOutlets.leave(host);
			restoreFocus();
		}
	});

	// Removed while open (the owner dropped it): the flags and the focus still go back.
	$effect(() => () => {
		flagOutlets.leave(host);
		if (returnTarget !== null) restoreFocus();
	});

	function request(trigger: CloseTrigger) {
		if (trigger === 'escape' && busy && onbusyescape) {
			onbusyescape();
			return;
		}
		switch (closeAction(trigger, { dirty, busy, asking })) {
			case 'close':
				onclose(trigger);
				break;
			case 'ask':
				askedBy = trigger;
				focusBeforeAsking = activeElement();
				asking = true;
				void tick().then(() => keepButton?.focus());
				break;
			case 'resume':
				resume();
				break;
		}
	}

	async function resume() {
		asking = false;
		await tick();
		const target = focusBeforeAsking?.isConnected ? focusBeforeAsking : first(body);
		focusBeforeAsking = null;
		target?.focus();
	}

	function discard() {
		asking = false;
		onclose(askedBy);
	}

	/**
	 * Escape is handled on keydown, not on cancel: Chromium does not let a page prevent a second
	 * cancel without a new user activation (close watcher), so a busy or dirty dialog would close.
	 * An Escape an inner element consumed (defaultPrevented) stays with it.
	 */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		request('escape');
	}

	/** Fallback when the browser sends a close request without the key (e.g. other devices). */
	function onDialogCancel(event: Event) {
		event.preventDefault();
		if (dialog?.open && open) request('escape');
	}

	/** The browser closed the dialog by itself: follow the rules, or show it again. */
	function onDialogClose() {
		if (!open || dialog === undefined) return;
		const action = closeAction('escape', { dirty, busy, asking });
		if (action === 'close') {
			onclose('escape');
			return;
		}
		dialog.showModal();
		holdFlags();
		if (action === 'ask') request('escape');
	}

	// The <dialog> has no padding and its frame fills it, so a pointer on the dialog element itself
	// is a pointer on the veil. Only press and release there count: selecting text inside and
	// releasing outside does not close.
	function onpointerdown(event: PointerEvent) {
		pressedOnVeil = event.target === dialog;
	}

	function onclick(event: MouseEvent) {
		const onVeil = pressedOnVeil && event.target === dialog;
		pressedOnVeil = false;
		if (onVeil) request('blanket');
	}
</script>

<dialog
	class={`modal size-${size}`}
	class:sheet={shownAs === 'sheet'}
	class:page={shownAs === 'page'}
	aria-labelledby={titleId}
	aria-describedby={describedBy}
	aria-busy={busy}
	data-overlay
	bind:this={dialog}
	{onkeydown}
	oncancel={onDialogCancel}
	onclose={onDialogClose}
	{onpointerdown}
	{onclick}
>
	{#if open}
		<div class="frame">
			<header class="head">
				{#if titleLead}
					<div class="title-line">
						{@render titleLead()}
						<h2 id={titleId}>{title}</h2>
					</div>
				{:else}
					<h2 id={titleId}>{title}</h2>
				{/if}
				<div class="head-actions">
					{@render headerActions?.()}
					<button
						class="button-icon"
						type="button"
						aria-label="Schließen"
						aria-disabled={busy}
						bind:this={closeButton}
						onclick={() => request('close-button')}
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				</div>
			</header>
			<div class="body" bind:this={body}>
				{@render children()}
			</div>
			{#if asking}
				<div class="foot discard" role="group" aria-labelledby={discardId} bind:this={foot}>
					<p id={discardId}><strong>{discardQuestion}</strong> {discardText}</p>
					<div class="buttons">
						<button class="button-secondary" type="button" bind:this={keepButton} onclick={resume}>
							Weiter bearbeiten
						</button>
						<button class="button-primary" type="button" onclick={discard}>Verwerfen</button>
					</div>
				</div>
			{:else if footer}
				<div class="foot" bind:this={foot}>
					<div class="buttons">
						{@render footer({ close: () => request('cancel') })}
					</div>
				</div>
			{/if}
		</div>
		{#if flags !== null}
			<FlagGroup store={flags} {host} />
		{/if}
	{/if}
</dialog>

<style>
	/*
	 * The <dialog> only places and sizes. It stays transparent and has no transform, filter or
	 * backdrop-filter, so it is no containing block for the flags in it (FL-1, position: fixed),
	 * and it clips nothing, so the shadow of the frame shows. The frame draws the surface.
	 */
	.modal {
		--modal-width: var(--overlay-width-m);
		width: min(var(--modal-width), calc(100vw - 2rem));
		max-width: none;
		max-height: var(--overlay-max-height);
		margin: auto;
		padding: 0;
		overflow: visible;
		color: var(--color-text);
		background: none;
		border: none;
	}

	/* Header and footer stay, the content scrolls alone. */
	.frame {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-height: var(--overlay-max-height);
		overflow: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-overlay);
		box-shadow: var(--shadow-modal);
	}

	/*
	 * Thick glass for the sizes S to L (ADR-0029 section 1): the blanket and the view shine through
	 * softly, lines on glass in --color-separator. The full view (XL) stays an opaque surface with
	 * the same radius and shadow, because it is a large area full of content.
	 */
	.modal:not(.size-xl) .frame {
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border-color: var(--color-separator);
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			var(--shadow-modal);
	}

	.modal:not(.size-xl) :is(.head, .foot) {
		border-color: var(--color-separator);
	}

	.size-s {
		--modal-width: var(--overlay-width-s);
	}

	.size-l {
		--modal-width: var(--overlay-width-l);
	}

	.size-xl {
		--modal-width: var(--overlay-width-xl);
		max-height: var(--overlay-max-height-xl);
	}

	.modal[open] {
		display: flex;
	}

	/* On the frame, not on the <dialog>: a transform there would hold the flags for its duration. */
	.modal[open] .frame {
		animation: modal-in var(--motion-medium) var(--motion-ease);
	}

	/* Darkening veil (ADR-0025 section 2), as in Jira and the reference layout. */
	.modal::backdrop {
		background: var(--color-blanket);
	}

	.modal[open]::backdrop {
		animation: veil-in var(--motion-medium) var(--motion-ease);
	}

	.size-xl .frame {
		max-height: var(--overlay-max-height-xl);
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
		padding: 0.75rem 0.75rem 0.75rem 1.25rem;
		border-bottom: 1px solid var(--color-line);
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.title-line {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
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
	}

	.body {
		display: grid;
		gap: 0.875rem;
		align-content: start;
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem 1.25rem;
		overflow-y: auto;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		justify-content: flex-end;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid var(--color-line);
	}

	.discard {
		justify-content: space-between;
	}

	.discard p {
		font-size: 0.875rem;
	}

	/*
	 * The buttons fill the footer and stand on the right; a button with margin-right: auto
	 * ("Andere Quelle", "Später fortsetzen") takes the free space and stands on the left.
	 */
	.buttons {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	/* Primary buttons of every footer have the size of the secondary ones. */
	.foot :global(.button-primary) {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	/* Below 48rem the full view uses the whole screen. */
	@media (max-width: 47.99rem) {
		.size-xl {
			width: 100vw;
			max-height: 100dvh;
			height: 100dvh;
		}

		.size-xl .frame {
			max-height: 100dvh;
			border: none;
			border-radius: 0;
		}
	}

	/*
	 * Sheet of the phone frame (MO-1a, ADR-0073): at the bottom over the full width, at most
	 * --sheet-max-height high, so a strip of the blanket stays to tap; round upper corners, no line
	 * at the bottom, the safe area of the system bar below the content. The × gets the target of the
	 * phone frame. It slides up from below; reduced motion shows it at once (base.css).
	 */
	.modal.sheet {
		width: 100%;
		max-height: var(--sheet-max-height);
		margin: auto 0 0;
	}

	.sheet .frame {
		max-height: var(--sheet-max-height);
		padding-bottom: var(--safe-bottom);
		border-bottom: none;
		border-radius: var(--radius-overlay) var(--radius-overlay) 0 0;
	}

	.sheet .head-actions .button-icon {
		width: var(--phone-target);
		height: var(--phone-target);
	}

	.modal.sheet[open] .frame {
		animation-name: sheet-in;
	}

	/*
	 * Page of the phone frame (MO-1b, ADR-0073 addendum): the sizes L and XL take the whole screen,
	 * without a strip of the blanket and without round corners; the safe areas of the status bar and
	 * of the system bar lie inside, above the head and below the content. The × gets the target of
	 * the frame. With interactive-widget=resizes-content the page shrinks with the on-screen
	 * keyboard (100dvh), so its footer stays above it.
	 */
	.modal.page {
		width: 100%;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0;
	}

	.page .frame {
		height: 100%;
		max-height: 100dvh;
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
		border: none;
		border-radius: 0;
	}

	.page .head-actions .button-icon {
		width: var(--phone-target);
		height: var(--phone-target);
	}

	@keyframes sheet-in {
		from {
			transform: translateY(100%);
		}
	}

	@keyframes modal-in {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
	}

	@keyframes veil-in {
		from {
			opacity: 0;
		}
	}
</style>
