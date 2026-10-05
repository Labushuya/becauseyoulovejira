<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import { setPinStore, type PinStore } from '$lib/stores/pins.svelte';

	// Test harness (ticket-panel.test.ts, ADR-0064): the detail panel below the store of the own pins,
	// as the (app) layout provides it.
	let { pins, ...panel }: { pins: PinStore } & ComponentProps<typeof TicketPanel> = $props();

	// svelte-ignore state_referenced_locally
	setPinStore(pins);
</script>

<TicketPanel {...panel} />
