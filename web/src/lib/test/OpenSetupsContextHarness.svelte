<script lang="ts">
	import PhoneTabBar from '$lib/components/phone/PhoneTabBar.svelte';
	import { setOpenSetupsStore, type OpenSetupsStore } from '$lib/stores/open-setups.svelte';

	// Test harness (open-setups-mark.test.ts, KE-1): the store of the open setups as the (app)
	// layout provides it, below it the bottom bar of the phone frame with its sheet "Mehr".
	let { store }: { store: OpenSetupsStore } = $props();

	// svelte-ignore state_referenced_locally
	setOpenSetupsStore(store);
</script>

<PhoneTabBar onquick={() => undefined} />
