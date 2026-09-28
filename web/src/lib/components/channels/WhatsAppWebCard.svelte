<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { keywordSummary } from '$lib/domain/channel-health';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import ChannelIcon from './ChannelIcon.svelte';
	import ChannelKeywordsModal from './ChannelKeywordsModal.svelte';

	// Card "WhatsApp Web (Browser-Erweiterung)" (ADR-0038 §4, plan eigener-eingang-whatsapp-web
	// EI-3): what the extension does and does not do, its keywords, "Einrichten …" (the assistant in
	// the address, ?einrichten=whatsapp-web), "Stichwörter …" and the help. The app cannot see the
	// extension itself; the assistant checks it through the last use of the key.
	let {
		importKeywords = null,
		setupHref
	}: {
		importKeywords?: ImportKeywordsStore | null;
		/** Address of the assistant. */
		setupHref: ResolvedPathname;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let editingKeywords = $state(false);

	const keywords = $derived(
		importKeywords?.state === 'ready'
			? keywordSummary(importKeywords.settings['whatsapp-web'].keywords)
			: null
	);
</script>

<section class="card" aria-labelledby={headingId}>
	<header class="head">
		<ChannelIcon kind="whatsapp-web" />
		<div class="names">
			<h4 id={headingId}>WhatsApp Web (Browser-Erweiterung)</h4>
			<p class="kind">Für Edge und Chrome, liest nur</p>
		</div>
	</header>
	<p>
		Im offenen WhatsApp-Web-Tab legst du Nachrichten mit „In den Eingang“ ab; auf Wunsch kommen neue
		Nachrichten mit Stichwort automatisch. Die Erweiterung sendet nie etwas in WhatsApp.
	</p>
	{#if keywords !== null}
		<p class="meta">Stichwörter für „Automatisch“: {keywords}</p>
	{/if}
	<footer class="actions">
		<a
			class="button-secondary"
			href={setupHref}
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			Einrichten<span class="visually-hidden">: WhatsApp Web</span>
		</a>
		{#if importKeywords !== null}
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				onclick={() => (editingKeywords = true)}
			>
				Stichwörter …<span class="visually-hidden">: WhatsApp Web</span>
			</button>
		{/if}
		<a class="help" href={helpHref('whatsapp-web')}>So geht’s</a>
	</footer>
</section>

{#if editingKeywords && importKeywords !== null}
	<ChannelKeywordsModal
		kind="whatsapp-web"
		store={importKeywords}
		onclose={() => (editingKeywords = false)}
	/>
{/if}

<style>
	.card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.625rem;
		align-items: center;
	}

	.names {
		min-width: 0;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	p {
		font-size: var(--font-size-body);
	}

	.kind,
	.meta {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.actions a.button-secondary {
		text-decoration: none;
	}

	.help {
		color: var(--color-brand-text);
	}
</style>
