<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { setOutboxContext, type OutboxStore } from '$lib/offline/outbox.svelte';
	import { setTicketHost, type TicketHost } from '$lib/ticket-host';

	// Test harness (OF-3): a component below the host of an area layout and the outbox of the (app)
	// layout, so its marks of kept changes show (PendingMark finds the outbox in the context).
	let {
		outbox,
		host,
		component,
		props
	}: {
		outbox: OutboxStore;
		host: TicketHost;
		/** Any component; its props come in `props`. */
		component: Component<never>;
		props: Record<string, unknown>;
	} = $props();

	setOutboxContext(untrack(() => outbox));
	setTicketHost(untrack(() => host));
	const Inner = $derived(component as unknown as Component<Record<string, unknown>>);
</script>

<Inner {...props} />
