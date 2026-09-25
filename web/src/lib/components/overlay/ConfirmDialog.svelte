<script lang="ts">
	import type { Snippet } from 'svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import Modal from './Modal.svelte';

	// Confirmation (ADR-0025 section 4): the modal in size S with the question as title, a text and
	// a footer with "Abbrechen" and a verb ("Löschen", "Verwerfen"). The focus starts on
	// "Abbrechen"; Escape, × and a click on the veil mean "Abbrechen". While the confirmed action
	// runs, every way is locked and the button says "Wird ausgeführt …"; a failure shows inside.
	// No red: the text and the verb make it clear (ADR-0009).
	let {
		open,
		title,
		confirmLabel,
		cancelLabel = 'Abbrechen',
		busy = false,
		error = null,
		onconfirm,
		oncancel,
		children
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
	} = $props();

	const uid = $props.id();
	const textId = `${uid}-text`;

	let cancelButton = $state<HTMLButtonElement>();
</script>

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
>
	<div class="text" id={textId}>
		{@render children()}
	</div>
	{#if error}
		<div class="alert-error" role="alert">
			<ErrorIcon />
			<span>{error}</span>
		</div>
	{/if}
	{#snippet footer({ close })}
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
			class="button-primary confirm-button"
			type="button"
			aria-disabled={busy}
			onclick={() => {
				if (!busy) onconfirm();
			}}
		>
			{busy ? 'Wird ausgeführt …' : confirmLabel}
		</button>
	{/snippet}
</Modal>

<style>
	.text {
		display: grid;
		gap: 0.5rem;
	}

	.confirm-button {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	.confirm-button[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
