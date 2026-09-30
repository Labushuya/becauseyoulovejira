<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { closeAction, type CloseTrigger } from '$lib/overlay/close-rules';

	// A dialog inside a modal, embedded in the content (ADR-0025 section 3 and addendum 16): the
	// full view is a modal, and no dialog opens from a dialog, so a form that opens as a modal from
	// the side panel ("Wiederholen…", "Regel bearbeiten", "Quelle hinzufügen …", "Anderem Ticket
	// zuordnen …") stands here as an unfolded area where it was asked for, like the inline editor
	// of the template (plan WV). Not an overlay: no veil, no focus trap, no top layer. It keeps the
	// rules of its modal: Escape (consumed, so the full view stays) and "Abbrechen" close through
	// close-rules.ts, a running action blocks every way, and like the modals of these forms it asks
	// nothing before closing. The focus goes to `initialFocus` or the first control of the content
	// on opening and back to the element that had it on closing; if that is gone, to `returnFocus`.
	let {
		open,
		title,
		describedBy,
		busy = false,
		initialFocus,
		returnFocus,
		onclose,
		footer,
		children
	}: {
		open: boolean;
		/** Visible title, names the area. */
		title: string;
		/** ID of the element that describes the area. */
		describedBy?: string;
		/** An action runs: nothing closes, aria-busy is set. */
		busy?: boolean;
		/** Element that gets the focus on opening; otherwise the first control of the content. */
		initialFocus?: HTMLElement | null;
		/** Where the focus goes on closing when the element that opened the area is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
		/** The area asks its owner to close, with the way the user chose. */
		onclose: (reason: CloseTrigger) => void;
		/** Buttons of the area; `close` is "Abbrechen" under the closing rules. */
		footer?: Snippet<[{ close: () => void }]>;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const FOCUSABLE =
		'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

	let body = $state<HTMLElement>();
	let foot = $state<HTMLElement>();
	let returnTarget: HTMLElement | null = null;
	let shown = false;

	function first(container: HTMLElement | undefined): HTMLElement | null {
		return container?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
	}

	function restoreFocus() {
		const target = returnTarget;
		returnTarget = null;
		if (target !== null && target.isConnected) target.focus();
		else untrack(() => returnFocus?.())?.focus();
	}

	$effect(() => {
		if (open && !shown) {
			shown = true;
			const active = document.activeElement;
			returnTarget = active instanceof HTMLElement && active !== document.body ? active : null;
			void tick().then(() => (untrack(() => initialFocus) ?? first(body) ?? first(foot))?.focus());
		} else if (!open && shown) {
			shown = false;
			void tick().then(restoreFocus);
		}
	});

	// Removed while open (the owner dropped it): the focus still goes back.
	$effect(() => () => {
		if (shown) void tick().then(restoreFocus);
	});

	function request(trigger: CloseTrigger) {
		if (closeAction(trigger, { dirty: false, busy, asking: false }) === 'close') onclose(trigger);
	}

	/** Escape closes the area, unless an element inside used it (a list, a text editor). */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		request('escape');
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		class="inline-dialog"
		aria-labelledby={titleId}
		aria-describedby={describedBy}
		aria-busy={busy ? 'true' : undefined}
		data-inline-dialog
		{onkeydown}
	>
		<h4 id={titleId}>{title}</h4>
		<div class="body" bind:this={body}>
			{@render children()}
		</div>
		{#if footer}
			<div class="foot" bind:this={foot}>
				{@render footer({ close: () => request('cancel') })}
			</div>
		{/if}
	</section>
{/if}

<style>
	/* Framed like the inline editor of the template (plan WV), opaque inside the full view. */
	.inline-dialog {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.body {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	/* Locked while the action runs (ADR-0026, addendum of 2026-09-30). */
	.inline-dialog[aria-busy='true'] :global([aria-disabled='true']) {
		cursor: progress;
	}
</style>
