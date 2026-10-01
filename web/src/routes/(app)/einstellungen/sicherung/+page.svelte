<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import BackupView from '$lib/components/backup/BackupView.svelte';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { pb } from '$lib/pocketbase';
	import { BackupStore, backupData } from '$lib/stores/backup.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';

	// Settings "Sicherung" (ADR-0046): backups, target folder, passphrase and access data. The store
	// lives with the page; it loads the state once the server counts as Windows (like the page
	// System) and ends its requests when the page goes. Results of changes go out as flags.
	const host = findHostStore();
	const store = new BackupStore(backupData(pb), auth, getFlagStore());
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
	<title>Sicherung · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<BackupView {store} {platform} />
