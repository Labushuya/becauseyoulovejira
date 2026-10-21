<script lang="ts">
	import OfflineNotice from '$lib/components/offline/OfflineNotice.svelte';
	import type { OutboxStore } from '$lib/offline/outbox.svelte';

	// Test harness (OF-3c round 2, C-3): the hints of the outbox in the main content as the (app) layout
	// places them, only while the outbox works, keeps something or has a notice; with or without the
	// heading of a view (`data-view-heading`).
	let { outbox, heading = false }: { outbox: OutboxStore; heading?: boolean } = $props();
</script>

<main class="content" tabindex="-1">
	{#if outbox.watching || outbox.count > 0 || outbox.notices.length > 0}
		<OfflineNotice {outbox} onshow={() => undefined} />
	{/if}
	{#if heading}
		<h2 tabindex="-1" data-view-heading>Aufgaben</h2>
	{/if}
	<p>Inhalt der Ansicht</p>
</main>
