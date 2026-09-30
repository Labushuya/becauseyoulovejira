<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import SystemView from '$lib/components/system/SystemView.svelte';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import { SystemStore, systemData } from '$lib/stores/system.svelte';

	// Settings "System" (ADR-0043): operation of the app from the dashboard. The store lives with the
	// page; it loads the status once the server counts as Windows (until the answer of the host
	// route it does, like the guides) and ends its requests when the page goes. Results of actions
	// go out as flags (ADR-0025 section 8).
	const host = findHostStore();
	const store = new SystemStore(systemData(pb), auth, getFlagStore());
	const platform = $derived(host?.platform ?? DEFAULT_HOST_PLATFORM);
	let loaded = false;

	$effect(() => {
		if (platform !== 'windows' || loaded) return;
		loaded = true;
		untrack(() => void store.load());
	});
	$effect(() => () => store.dispose());
</script>

<svelte:head>
	<title>System · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<SystemView {store} {platform} />
