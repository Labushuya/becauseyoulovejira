<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import TagManager from '$lib/components/TagManager.svelte';
	import { pb } from '$lib/pocketbase';
	import { CatalogEditor, catalogEditorData } from '$lib/stores/catalog-editor';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';

	// Settings "Tags" (user request after EH-4): the tag list with "Umbenennen" and "Löschen …",
	// until then a section below the project tiles. The tags come from the catalog of the (app)
	// layout, so renames and deletions show in the tables at once; results go out as flags. Deleting
	// asks through the confirmation; when the tag is gone the focus falls back to the heading of the
	// page (data-view-heading of the settings layout).
	const catalog = getCatalogStore();
	const flags = getFlagStore();
	const editor = new CatalogEditor(catalogEditorData(pb), auth, catalog);
</script>

<svelte:head>
	<title>Tags · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<p class="intro">
	Tags entstehen im Detail eines Tickets oder bei „Neues Ticket“. Hier benennst du sie um oder
	löschst sie; die Tickets folgen sofort.
</p>

{#if catalog.state === 'error' && catalog.error}
	<SectionMessage tone="error" live>
		{catalog.error}
		{#snippet actions()}
			<button class="button-subtle" type="button" onclick={() => catalog.reload()}>
				Erneut versuchen
			</button>
		{/snippet}
	</SectionMessage>
{:else if catalog.state !== 'ready'}
	<p class="loading" role="status">Tags werden geladen …</p>
{:else}
	<TagManager
		tags={catalog.tags}
		{editor}
		onannounce={(title) => flags.show({ tone: 'success', title })}
	/>
{/if}

<style>
	.intro,
	.loading {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
</style>
