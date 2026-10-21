<script lang="ts">
	import OfflineNotice from '$lib/components/offline/OfflineNotice.svelte';
	import type { OutboxStore } from '$lib/offline/outbox.svelte';

	// Test harness (OF-3c round 2, C-3): the hints of the outbox in the main content as the (app) layout
	// places them, only while the outbox works, keeps something or has a notice; with or without the
	// heading of a view (`data-view-heading`), with `tabindex="-1"` as SectionBar has it or without one
	// (`plain`). Since round 3 (C2-5) `main` has no `tabindex` of its own, as in the layout; a test
	// compares the condition and `main` with the layout.
	let { outbox, heading = false }: { outbox: OutboxStore; heading?: boolean | 'plain' } = $props();
</script>

<main class="content">
	{#if outbox.watching || outbox.count > 0 || outbox.notices.length > 0}
		<OfflineNotice {outbox} onshow={() => undefined} />
	{/if}
	{#if heading === 'plain'}
		<h2 data-view-heading>Aufgaben</h2>
	{:else if heading}
		<h2 tabindex="-1" data-view-heading>Aufgaben</h2>
	{/if}
	<p>Inhalt der Ansicht</p>
</main>
