<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import ImportKeywordsSection from '$lib/components/ImportKeywordsSection.svelte';
	import { pb } from '$lib/pocketbase';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { ImportKeywordsStore, importKeywordsData } from '$lib/stores/import-keywords.svelte';

	// Settings "Datei-Importe" (ADR-0026 section 1, plan EH-1): the keywords of the file imports
	// (E4 plan, package 21; ADR-0020), until EH-1 a part of the page "Kanäle". They load when the page
	// opens and leave with it; results go out as flags.
	const flags = getFlagStore();
	const importKeywords = new ImportKeywordsStore(importKeywordsData(pb), auth, flags);

	$effect(() => {
		untrack(() => void importKeywords.load());
		return () => importKeywords.reset();
	});
</script>

<svelte:head>
	<title>Datei-Importe · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<ImportKeywordsSection store={importKeywords} />
