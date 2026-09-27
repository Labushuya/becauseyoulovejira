<script lang="ts">
	import type { SyncAllStore } from '$lib/stores/sync-all.svelte';

	// "Alle Kanäle jetzt abrufen" of the inbox view (testing feedback package A, item 4). While it
	// runs, the button is busy and a polite status names the connection that runs ("„Web.de“ wird
	// abgerufen (2 von 3) …"); the result comes as one flag, which has its own live region.
	let { store }: { store: SyncAllStore } = $props();
</script>

<span class="sync-all">
	<button
		class="button-secondary"
		type="button"
		aria-disabled={store.running ? 'true' : undefined}
		aria-busy={store.running ? 'true' : undefined}
		onclick={() => {
			if (!store.running) void store.runAll();
		}}
	>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M13 3v3.5H9.5M3 13V9.5h3.5" />
			<path d="M12.6 6.5A5 5 0 0 0 3.8 5M3.4 9.5a5 5 0 0 0 8.8 1.5" />
		</svg>
		{store.running ? 'Wird abgerufen …' : 'Alle Kanäle jetzt abrufen'}
	</button>
	<span class="status" role="status">{store.running ? store.status : ''}</span>
</span>

<style>
	.sync-all {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}

	button {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
	}

	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.status {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
