<script lang="ts">
	import { resolve } from '$app/paths';
	import { auth } from '$lib/auth.svelte';
	import OwnAccountView from '$lib/components/accounts/OwnAccountView.svelte';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { OwnAccountStore, ownAccountData } from '$lib/stores/own-account.svelte';

	// Settings "Mein Konto" (ADR-0026 section 1, plan EH-8; since E7-1, ADR-0056 §3; named so since
	// UI-1, ADR-0060): the signed-in app account with its display name and its password, both changed
	// here; who manages the accounts (the administrator of the app on "Konten verwalten") and, for the
	// administrator, the separate admin account of PocketBase. "Abmelden" stays in the header.
	const store = new OwnAccountStore(ownAccountData(pb), auth, getFlagStore());

	$effect(() => () => store.dispose());
</script>

<svelte:head>
	<title>Mein Konto · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<OwnAccountView
	{store}
	email={auth.email}
	name={auth.name}
	admin={auth.isAdmin}
	accountsHref={resolve('/einstellungen/konten')}
/>
