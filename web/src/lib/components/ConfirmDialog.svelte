<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// Safety question as a native modal <dialog> (E2 plan, T-12): focus trap and Escape come from
	// the browser. The focus starts on "Abbrechen". Escape and "Abbrechen" cancel; Escape does not
	// reach the surrounding panel, so it does not close it as well. While the confirmed action
	// runs, both buttons are locked and Escape is ignored; a failure shows the message inside.
	let {
		open,
		title,
		confirmLabel,
		busy = false,
		error = null,
		onconfirm,
		oncancel,
		children
	}: {
		open: boolean;
		title: string;
		confirmLabel: string;
		busy?: boolean;
		error?: string | null;
		onconfirm: () => void;
		oncancel: () => void;
		children: Snippet;
	} = $props();

	const uid = $props.id();

	let dialog = $state<HTMLDialogElement>();
	let cancelButton = $state<HTMLButtonElement>();

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		if (open && !element.open) {
			element.showModal();
			void tick().then(() => cancelButton?.focus());
		} else if (!open && element.open) {
			element.close();
		}
	});

	function cancel() {
		if (!busy) oncancel();
	}

	/** Escape in the browser: the dialog would close by itself, the parent state decides. */
	function onDialogCancel(event: Event) {
		event.preventDefault();
		cancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') event.stopPropagation();
	}
</script>

<dialog
	class="confirm"
	bind:this={dialog}
	aria-labelledby={`${uid}-title`}
	aria-describedby={`${uid}-text`}
	aria-busy={busy}
	oncancel={onDialogCancel}
	{onkeydown}
>
	<h2 id={`${uid}-title`}>{title}</h2>
	<div class="text" id={`${uid}-text`}>
		{@render children()}
	</div>
	{#if error}
		<div class="alert-error" role="alert">
			<ErrorIcon />
			<span>{error}</span>
		</div>
	{/if}
	<div class="buttons">
		<button
			class="secondary"
			type="button"
			bind:this={cancelButton}
			aria-disabled={busy}
			onclick={cancel}
		>
			Abbrechen
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
	</div>
</dialog>

<style>
	.confirm {
		width: min(28rem, calc(100vw - 2rem));
		margin: auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.confirm[open] {
		display: grid;
		gap: 0.875rem;
	}

	/* Veils the page in the background color of the mode (no extra color token). */
	.confirm::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
	}

	.text {
		display: grid;
		gap: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.confirm-button {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
