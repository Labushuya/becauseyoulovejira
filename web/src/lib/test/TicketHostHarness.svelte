<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { setTicketHost, type TicketHost } from '$lib/ticket-host';

	// Test harness (ADR-0054): a component below the host of an area layout (projects, inbox, rules),
	// so its ticket links stay in that area.
	let {
		host,
		component,
		props
	}: {
		host: TicketHost;
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	setTicketHost(untrack(() => host));
	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Inner {...props} />
