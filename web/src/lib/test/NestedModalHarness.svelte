<script lang="ts">
	import Modal from '$lib/components/overlay/Modal.svelte';

	// Test harness of the guard "kein Dialog aus einem Dialog" (modal-context.test.ts): an open
	// modal with a second modal inside it, open from the start or opened later (`openInner`).
	let { innerOpen = false }: { innerOpen?: boolean } = $props();

	// svelte-ignore state_referenced_locally
	let inner = $state(innerOpen);

	/** Opens the inner modal, as a button inside the outer one would. */
	export function openInner(): void {
		inner = true;
	}
</script>

<Modal open title="Vollansicht" onclose={() => undefined}>
	<p>Inhalt</p>
	<Modal open={inner} title="Zweiter Dialog" onclose={() => (inner = false)}>
		<p>Darf es nicht geben.</p>
	</Modal>
</Modal>
