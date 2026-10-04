<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import AccountsView from '$lib/components/accounts/AccountsView.svelte';
	import { pb } from '$lib/pocketbase';
	import { AccountsStore, accountsData } from '$lib/stores/accounts.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';

	// Settings "Konten" (ADR-0056 §3): the accounts of the app for its administrator. The store lives
	// with the page; it loads once when the page opens and ends its requests when the page goes (the
	// start passwords it showed go with it). Results of changes go out as flags.
	const store = new AccountsStore(accountsData(pb), auth, getFlagStore());

	$effect(() => untrack(() => void store.load()));
	$effect(() => () => store.dispose());
</script>

<svelte:head>
	<title>Konten · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<AccountsView {store} />
