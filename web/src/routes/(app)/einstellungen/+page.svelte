<script lang="ts">
	import SettingsGroupList from '$lib/components/SettingsGroupList.svelte';

	// Overview of the settings (EU-1, ADR-0078; concept MO-0: a start page with the grouped list): the
	// pages in the groups of the navigation, each with one sentence of what is done there and the
	// marks of the navigation (open setups at "Kanäle", "nur am PC" for the pages of the
	// administrator on another device; not there for every other account). The gear of the header
	// and the first step of the breadcrumbs lead here. Before EU-1 this address forwarded to
	// "Kanäle" (ADR-0026 section 1). Heading, breadcrumbs and the navigation come from the layout;
	// in the phone frame the overview is the navigation itself.
</script>

<svelte:head>
	<title>Einstellungen · becauseyoulovejira</title>
</svelte:head>

<div class="overview">
	<SettingsGroupList overview />
</div>

<style>
	.overview {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		max-width: 80ch;
	}
</style>
