<script lang="ts">
	import Modal from '$lib/components/overlay/Modal.svelte';
	import type { CloseTrigger } from '$lib/overlay/close-rules';

	// Test harness for the modal building block (modal.test.ts): a button opens it, the content has
	// a text field, the footer "Abbrechen" and "Speichern". Every close request is recorded and
	// closes the modal, as an owner would do.
	let {
		dirty = false,
		busy = false,
		withFooter = true,
		onreason = () => undefined
	}: {
		dirty?: boolean;
		busy?: boolean;
		withFooter?: boolean;
		onreason?: (reason: CloseTrigger) => void;
	} = $props();

	let open = $state(false);
</script>

<button type="button" onclick={() => (open = true)}>Öffnen</button>
{#if withFooter}
	<Modal
		{open}
		title="Projekt bearbeiten"
		{dirty}
		{busy}
		onclose={(reason) => {
			onreason(reason);
			open = false;
		}}
	>
		<label>Name <input type="text" /></label>
		{#snippet footer({ close })}
			<button type="button" onclick={close}>Abbrechen</button>
			<button type="button">Speichern</button>
		{/snippet}
	</Modal>
{:else}
	<Modal
		{open}
		title="Hinweis"
		onclose={(reason) => {
			onreason(reason);
			open = false;
		}}
	>
		<p>Nur Text.</p>
	</Modal>
{/if}
