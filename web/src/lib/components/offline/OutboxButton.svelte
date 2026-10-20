<script lang="ts">
	import { OFFLINE_TEXTS } from '$lib/domain/offline';
	import type { OutboxStore } from '$lib/offline/outbox.svelte';
	import OfflineIcon from './OfflineIcon.svelte';

	// The symbol of the outbox in the top bar of the phone frame (OF-2, concept OF-0 §2.1, place
	// from MO-1b): "Offline · 3" without a connection, the cloud with the number while kept changes
	// wait or go out; a tap opens "Gemerkte Änderungen". Not there while the connection stands and
	// nothing waits, so the bar looks as before.
	let { outbox, onshow }: { outbox: OutboxStore; onshow: () => void } = $props();

	const offline = $derived(outbox.offline);
	const count = $derived(outbox.count);

	/** "Offline · 3", "Offline" or the number of kept changes. */
	function visible(): string {
		if (!offline) return String(count);
		return count > 0 ? `Offline · ${count}` : 'Offline';
	}
</script>

{#if offline || count > 0}
	<button
		class="button-subtle outbox-button"
		type="button"
		aria-label={OFFLINE_TEXTS.button(count, offline)}
		onclick={onshow}
	>
		<OfflineIcon kind={offline ? 'offline' : 'pending'} />
		<span aria-hidden="true">{visible()}</span>
	</button>
{/if}

<style>
	.outbox-button {
		display: inline-flex;
		flex: none;
		gap: 0.375rem;
		align-items: center;
		min-height: var(--phone-target);
		white-space: nowrap;
	}
</style>
