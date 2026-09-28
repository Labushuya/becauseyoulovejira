<script lang="ts">
	import HostPlatformNote from '$lib/components/guidance/HostPlatformNote.svelte';
	import { setHostStore, type HostStore } from '$lib/stores/host.svelte';

	// Test harness (host-platform-note.test.ts, plan plattformen S0-3): the store of the server
	// system as the (app) layout provides it, below it the note above the Windows guides.
	let { store }: { store: HostStore } = $props();

	// svelte-ignore state_referenced_locally
	setHostStore(store);
</script>

<HostPlatformNote />
