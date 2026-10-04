<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import SecurityView from '$lib/components/security/SecurityView.svelte';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { SecurityLanStore, securityLanData } from '$lib/stores/security-lan.svelte';
	import { SecurityStore, securityData } from '$lib/stores/security.svelte';

	// Settings "Sicherheit" (ADR-0055 §8): how the app protects itself and what can be set. The stores
	// live with the page; they load once when the page opens (on every server; the further hosts and
	// the access in the home network only for the own instance under Windows, whose control script
	// reads the network and the firewall) and end their requests when the page goes. Saved changes
	// go out as flags.
	const flags = getFlagStore();
	const store = new SecurityStore(securityData(pb), auth, flags);
	const lan = new SecurityLanStore(securityLanData(pb), auth, flags);

	async function load() {
		await store.load();
		const overview = store.overview;
		if (overview !== null && overview.lan.ready && overview.lan.editable) await lan.load();
	}

	$effect(() => untrack(() => void load()));
	$effect(() => () => {
		store.dispose();
		lan.dispose();
	});
</script>

<svelte:head>
	<title>Sicherheit · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<SecurityView {store} {lan} />
