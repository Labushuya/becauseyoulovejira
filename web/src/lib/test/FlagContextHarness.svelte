<script lang="ts">
	import type { Component } from 'svelte';
	import { setFlagStore, type FlagStore } from '$lib/stores/flags.svelte';

	// Test harness: the flags of the app layout in the context around one component, as the (app)
	// layout sets them (OF-4b, B-1 and B-2: a locked control names its reason in a flag).
	let {
		store,
		component: Inner,
		props
	}: {
		store: FlagStore;
		component: Component<Record<string, unknown>>;
		props: Record<string, unknown>;
	} = $props();

	// svelte-ignore state_referenced_locally
	setFlagStore(store);
</script>

<Inner {...props} />
