<script lang="ts">
	import { untrack, type ComponentProps } from 'svelte';
	import RestartNeededNotice from '$lib/components/system/RestartNeededNotice.svelte';
	import { setOutboxContext, type OutboxStore } from '$lib/offline/outbox.svelte';
	import { setRestartStore, type RestartStore } from '$lib/stores/restart.svelte';

	// Test harness (BW-2): the hint "restart needed" below the (app) layout, with the RestartStore of
	// the layout and, where a test needs it, the outbox whose connection is missing.
	let {
		layout = null,
		outbox = null,
		props
	}: {
		/** The store of the (app) layout (findRestartStore); null: none, as outside the layout. */
		layout?: RestartStore | null;
		/** The outbox of the (app) layout (findOutbox); null: none. */
		outbox?: OutboxStore | null;
		props: ComponentProps<typeof RestartNeededNotice>;
	} = $props();

	const initialLayout = untrack(() => layout);
	const initialOutbox = untrack(() => outbox);
	if (initialLayout !== null) setRestartStore(initialLayout);
	if (initialOutbox !== null) setOutboxContext(initialOutbox);
</script>

<RestartNeededNotice {...props} />
