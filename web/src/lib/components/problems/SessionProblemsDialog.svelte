<script lang="ts">
	import { PROBLEM_TEXTS } from '$lib/domain/problems';
	import Modal from '../overlay/Modal.svelte';
	import SessionProblemList from './SessionProblemList.svelte';

	// Dialog "Fehler dieser Sitzung" (FP-1, ADR-0071 §4): the root layout renders it once while the
	// list asks for it (problemLog.dialogOpen), from "Alle Fehler dieser Sitzung (n)" of a message
	// outside a modal or from the entry on the page "Hilfe". Modal M; the focus goes back to the
	// button that opened it.
	let { onclose }: { onclose: () => void } = $props();
</script>

<Modal open size="m" title={PROBLEM_TEXTS.listTitle} {onclose}>
	<SessionProblemList />

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>
