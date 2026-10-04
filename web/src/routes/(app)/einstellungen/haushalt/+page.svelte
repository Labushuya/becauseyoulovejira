<script lang="ts">
	import { untrack } from 'svelte';
	import HouseholdView from '$lib/components/household/HouseholdView.svelte';
	import { getHouseholdStore } from '$lib/stores/household.svelte';

	// Settings "Haushalt" (ADR-0058, E7-2): for every account and on every device, also in the home
	// network (nothing here acts on the machine of the app). The store lives in the (app) layout and
	// follows byl/household; opening the page reads it once more, so the codes show their status of now.
	const store = getHouseholdStore();

	$effect(() => untrack(() => void store.load()));
</script>

<svelte:head>
	<title>Haushalt · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<HouseholdView {store} />
