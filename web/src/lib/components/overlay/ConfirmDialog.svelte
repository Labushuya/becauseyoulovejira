<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { insideModal } from '$lib/overlay/modal-context';
	import ErrorIcon from '../ErrorIcon.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Modal from './Modal.svelte';

	// Confirmation (ADR-0025 section 4): the modal in size S with the question as title, a text and
	// a footer with "Abbrechen" and a verb ("Löschen", "Verwerfen"). The focus starts on
	// "Abbrechen"; Escape, × and a click on the veil mean "Abbrechen". While the confirmed action
	// runs, every way is locked and the button says "Wird ausgeführt …"; a failure shows inside.
	// No red: the text and the verb make it clear (ADR-0009). Optional `options` (e.g. radios of
	// "Quellen zurück in den Eingang" / "Quellen verwerfen", ADR-0031 addendum B) stand below the
	// text, outside the description of the dialog.
	// Inside a modal (the full view) no confirmation is stacked (ADR-0025 section 3 and 4, addendum
	// 16): the same question stands inline where the owner renders it, as a warning (no red) with
	// the same buttons, the focus on "Abbrechen", Escape as "Abbrechen" (consumed, so the full view
	// stays) and the focus back to where it was when the question closes.
	let {
		open,
		title,
		confirmLabel,
		cancelLabel = 'Abbrechen',
		busy = false,
		error = null,
		onconfirm,
		oncancel,
		children,
		options
	}: {
		open: boolean;
		title: string;
		confirmLabel: string;
		cancelLabel?: string;
		busy?: boolean;
		error?: string | null;
		onconfirm: () => void;
		oncancel: () => void;
		children: Snippet;
		options?: Snippet;
	} = $props();

	const uid = $props.id();
	const textId = `${uid}-text`;
	/** In a modal the question stands inline instead of in a dialog of its own. */
	const inline = insideModal();

	let cancelButton = $state<HTMLButtonElement>();
	/** Inline: element that had the focus when the question opened. */
	let origin: HTMLElement | null = null;
	let shown = false;

	function restoreFocus() {
		const target = origin;
		origin = null;
		if (target !== null && target.isConnected) target.focus();
	}

	$effect(() => {
		if (!inline) return;
		if (open && !shown) {
			shown = true;
			const active = document.activeElement;
			origin = active instanceof HTMLElement && active !== document.body ? active : null;
			void tick().then(() => untrack(() => cancelButton)?.focus());
		} else if (!open && shown) {
			shown = false;
			void tick().then(restoreFocus);
		}
	});

	// Removed while open inline (the owner dropped it): the focus still goes back.
	$effect(() => () => {
		if (inline && shown) void tick().then(restoreFocus);
	});

	function cancel() {
		if (!busy) oncancel();
	}

	/** Inline: Escape means "Abbrechen" and stays here, unless an element inside used it. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}
</script>

{#snippet content()}
	<div class="text" id={textId}>
		{@render children()}
	</div>
	{@render options?.()}
	{#if error}
		<div class="alert-error" role="alert">
			<ErrorIcon />
			<span>{error}</span>
		</div>
	{/if}
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button
		class="button-secondary"
		type="button"
		aria-disabled={busy}
		bind:this={cancelButton}
		onclick={close}
	>
		{cancelLabel}
	</button>
	<button
		class="button-primary"
		type="button"
		aria-disabled={busy}
		aria-busy={busy ? 'true' : undefined}
		onclick={() => {
			if (!busy) onconfirm();
		}}
	>
		{busy ? 'Wird ausgeführt …' : confirmLabel}
	</button>
{/snippet}

{#if inline}
	{#if open}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="inline-question"
			role="group"
			aria-label={title}
			aria-describedby={textId}
			aria-busy={busy ? 'true' : undefined}
			data-inline-question
			{onkeydown}
		>
			<SectionMessage tone="warning" {title} headingLevel={4}>
				<div class="inline-body">{@render content()}</div>
				{#snippet actions()}
					{@render buttons({ close: cancel })}
				{/snippet}
			</SectionMessage>
		</div>
	{/if}
{:else}
	<Modal
		{open}
		size="s"
		{title}
		describedBy={textId}
		{busy}
		initialFocus={cancelButton}
		onclose={() => {
			if (!busy) oncancel();
		}}
		footer={buttons}
	>
		{@render content()}
	</Modal>
{/if}

<style>
	.text,
	.inline-body {
		display: grid;
		gap: 0.5rem;
	}

	/* Locked while the confirmed action runs (ADR-0026, addendum of 2026-09-30). */
	.inline-question[aria-busy='true'] :global([aria-disabled='true']) {
		cursor: progress;
	}
</style>
