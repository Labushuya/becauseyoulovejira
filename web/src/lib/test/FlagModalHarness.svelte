<script lang="ts">
	import FlagGroup from '$lib/components/overlay/FlagGroup.svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';
	import { setFlagStore, type FlagStore } from '$lib/stores/flags.svelte';

	// Test harness of the flags in front of modals (flag-group.test.ts, FL-1, ADR-0025 addendum 18):
	// the flag store in the context and its FlagGroup after `main`, as in the app layout, and two
	// modals beside each other: the full view (XL) and a second one that opens on top of it, as the
	// top layer stacks them. They are siblings, so no modal opens inside another one (addendum 16).
	let { store }: { store: FlagStore } = $props();

	// svelte-ignore state_referenced_locally
	setFlagStore(store);

	let full = $state(false);
	let second = $state(false);
</script>

<main>
	<button type="button" onclick={() => (full = true)}>Vollansicht öffnen</button>
	<button type="button" onclick={() => (second = true)}>Zweiten Dialog öffnen</button>
</main>
<FlagGroup {store} />

<Modal open={full} size="xl" title="TASK-1 · Fenster putzen" onclose={() => (full = false)}>
	<label>Titel <input type="text" value="Fenster putzen" /></label>
</Modal>

<Modal open={second} size="s" title="Zweiter Dialog" onclose={() => (second = false)}>
	<p>Liegt über der Vollansicht.</p>
</Modal>
