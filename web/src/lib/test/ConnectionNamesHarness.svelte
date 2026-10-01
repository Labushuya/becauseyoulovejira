<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import {
		setConnectionNames,
		type ConnectionNamesStore
	} from '$lib/stores/connection-names.svelte';

	// Test harness (ADR-0026, addendum KK-3): a component below the names of the connections, as the
	// (app) layout provides them to the inbox panel and the sources of a ticket.
	let {
		names,
		component,
		props
	}: {
		names: ConnectionNamesStore;
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	setConnectionNames(untrack(() => names));
	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Inner {...props} />
