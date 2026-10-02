<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import StorageView from '$lib/components/storage/StorageView.svelte';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import { StorageStore, storageData } from '$lib/stores/storage.svelte';

	// Settings "Speicher" (ADR-0047 §6 to §9): what the app takes and what can be cleared. The store
	// lives with the page; it measures once when the page opens (on every platform, the server leaves
	// out what it cannot measure there) and ends its requests when the page goes. Results of actions
	// go out as flags.
	const host = findHostStore();
	const store = new StorageStore(storageData(pb), auth, getFlagStore());
	const platform = $derived(host?.platform ?? DEFAULT_HOST_PLATFORM);

	$effect(() => untrack(() => void store.load()));
	$effect(() => () => store.dispose());
</script>

<svelte:head>
	<title>Speicher · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<StorageView {store} {platform} />
