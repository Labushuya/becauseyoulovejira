<script lang="ts">
	import { CHANNEL_KIND_LABELS, CHANNEL_SEARCH_TEXT, type ChannelKind } from '$lib/domain/keywords';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Stichwörter: ‹Kanal›" of a channel of the own inbox (ADR-0038; the same editor as every channel,
	// ADR-0020): an entry of the mode "auto" is taken only with one of these keywords. Every change
	// is saved at once, so the footer says "Schließen" (ADR-0025 section 3); results go out as flags.
	let {
		kind,
		store,
		onclose
	}: {
		kind: ChannelKind;
		store: ImportKeywordsStore;
		onclose: () => void;
	} = $props();

	const label = $derived(CHANNEL_KIND_LABELS[kind]);
</script>

<Modal open size="m" title={`Stichwörter: ${label}`} onclose={() => onclose()}>
	{#if store.state === 'ready'}
		<KeywordEditor
			keywords={store.settings[kind].keywords}
			name={label}
			description={CHANNEL_SEARCH_TEXT[kind]}
			emptyText="Keine Stichwörter: Automatisch gesendete Einträge werden nicht übernommen, „In den Eingang“ und „mode: manual“ schon."
			onsave={(next, announcement) =>
				store.save(kind, { keywords: next, matchBody: false }, `${label}: ${announcement}`)}
		/>
	{:else if store.state === 'unavailable'}
		<SectionMessage tone="info" title={RESTART_NEEDED.title} headingLevel={4}>
			{RESTART_NEEDED.text}
		</SectionMessage>
	{:else if store.state === 'error'}
		<SectionMessage tone="error" live>
			{store.error}
			{#snippet actions()}
				<button class="button-secondary" type="button" onclick={() => void store.load()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else}
		<p class="hint" role="status">Stichwörter werden geladen …</p>
	{/if}

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>

<style>
	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
