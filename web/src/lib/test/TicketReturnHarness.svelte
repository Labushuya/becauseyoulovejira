<script lang="ts">
	import type { AreaTicketHost } from '$lib/ticket-host';
	import { followTicketReturn, type TicketReturn } from '$lib/ticket-return.svelte';

	// Test harness (ticket-return.test.ts, ADR-0054 §7): the layout of an area that follows its
	// navigations, as projects, inbox and rules do; the test gets the way back through `onready`.
	let { host, onready }: { host: AreaTicketHost; onready: (ret: TicketReturn) => void } = $props();

	// svelte-ignore state_referenced_locally
	onready(followTicketReturn(host));
</script>
