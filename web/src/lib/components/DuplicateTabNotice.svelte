<script lang="ts">
	import { untrack } from 'svelte';
	import { DUPLICATE_TAB } from '$lib/guidance/texts';
	import Modal from './overlay/Modal.svelte';

	// Second tab of the same browser (ADR-0035 section 6): a modal S that closes this tab after a
	// countdown of 5 s. "Hier weiterarbeiten" has the first focus, so nothing closes by accident;
	// it, Escape, × and a click on the veil keep the tab (WCAG 2.2.1). "Tab schließen" closes at
	// once. A browser may refuse window.close(); then the text says what to do.
	let {
		seconds = 5,
		onkeep,
		closeTab = () => window.close(),
		isClosed = () => window.closed
	}: {
		seconds?: number;
		/** The user keeps this tab (the owner marks it for the session and removes the notice). */
		onkeep: () => void;
		closeTab?: () => void;
		isClosed?: () => boolean;
	} = $props();

	const uid = $props.id();
	const textId = `${uid}-text`;
	const CLOSE_CHECK_MS = 300;

	// The start value only; the countdown runs on its own from there.
	let remaining = $state(untrack(() => seconds));
	let counting = $state(true);
	let failed = $state(false);
	let keepButton = $state<HTMLButtonElement>();

	function close() {
		counting = false;
		try {
			closeTab();
		} catch {
			// Not allowed: the check below shows the hint.
		}
		setTimeout(() => {
			if (!isClosed()) failed = true;
		}, CLOSE_CHECK_MS);
	}

	// One timer per second: the effect reads `remaining`, so every step plans the next one.
	$effect(() => {
		if (!counting) return;
		const left = remaining;
		const timer = setTimeout(() => {
			if (left > 1) remaining = left - 1;
			else close();
		}, 1000);
		return () => clearTimeout(timer);
	});

	function keep() {
		counting = false;
		onkeep();
	}
</script>

<Modal
	open
	size="s"
	title={DUPLICATE_TAB.title}
	describedBy={textId}
	initialFocus={keepButton}
	onclose={keep}
>
	<div id={textId} class="text">
		<p>{DUPLICATE_TAB.text}</p>
		{#if failed}
			<p>{DUPLICATE_TAB.closeFailed}</p>
		{:else if counting}
			<p>{DUPLICATE_TAB.closing(remaining)}</p>
		{/if}
	</div>
	{#snippet footer()}
		<button class="button-secondary" type="button" onclick={close}>{DUPLICATE_TAB.close}</button>
		<button class="button-primary" type="button" bind:this={keepButton} onclick={keep}>
			{DUPLICATE_TAB.keep}
		</button>
	{/snippet}
</Modal>

<style>
	.text {
		display: grid;
		gap: 0.5rem;
	}

	.text p {
		margin: 0;
	}
</style>
