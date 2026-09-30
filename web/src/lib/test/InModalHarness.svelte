<script lang="ts">
	import type { Component } from 'svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';

	// Test harness: a component inside an open modal, as in the full view (ADR-0025 section 3,
	// addendum 16). Components that would open a dialog there show it inline instead.
	let {
		component,
		props
	}: {
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Modal open size="xl" title="Vollansicht" onclose={() => undefined}>
	<Inner {...props} />
</Modal>
