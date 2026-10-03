<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import SecurityView from '$lib/components/security/SecurityView.svelte';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { SecurityStore, securityData } from '$lib/stores/security.svelte';

	// Settings "Sicherheit" (ADR-0055 §8): how the app protects itself and what can be set. The store
	// lives with the page; it loads once when the page opens (on every server, the further hosts only
	// for the own instance under Windows) and ends its requests when the page goes. Saved changes go
	// out as flags.
	const store = new SecurityStore(securityData(pb), auth, getFlagStore());

	$effect(() => untrack(() => void store.load()));
	$effect(() => () => store.dispose());
</script>

<svelte:head>
	<title>Sicherheit · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<SecurityView {store} />
