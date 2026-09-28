<script lang="ts">
	import { LIVE_INTERRUPTED } from '$lib/guidance/texts';
	import { liveHealth, type LiveHealth } from '$lib/stores/live-health.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Hint of the app layout while a realtime subscription failed and is tried again (ADR-0011 E6,
	// E2 plan §8): a warning without red (ADR-0009, ADR-0026 section 2), because the data stays
	// usable and only the live updates wait. It goes away by itself once every subscription
	// stands. The status region is always there, so screen readers announce the hint when it
	// appears; the focus never moves because of it.
	let {
		health = liveHealth,
		reload = () => window.location.reload()
	}: {
		health?: LiveHealth;
		reload?: () => void;
	} = $props();
</script>

<div class="live-update" class:shown={health.interrupted} role="status">
	{#if health.interrupted}
		<SectionMessage tone="warning">
			{LIVE_INTERRUPTED.text}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={reload}>
					{LIVE_INTERRUPTED.reload}
				</button>
			{/snippet}
		</SectionMessage>
	{/if}
</div>

<style>
	.shown {
		margin-bottom: 1rem;
	}
</style>
