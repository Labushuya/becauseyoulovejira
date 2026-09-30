<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { ExtensionInfo } from '$lib/data/extension';
	import { whatsAppWebStatus } from '$lib/domain/channel-card';
	import { keywordSummary } from '$lib/domain/channel-health';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import ChipList from '../ChipList.svelte';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';
	import ChannelKeywordsModal from './ChannelKeywordsModal.svelte';

	// Card "WhatsApp Web (Browser-Erweiterung)" (ADR-0038 §4, plan eigener-eingang-whatsapp-web EI-3;
	// since the plan kanal-karten KK-2 a configuration of the building block ChannelCard): the main
	// button "Einrichten" opens the assistant in the address (?einrichten=whatsapp-web), the menu
	// "•••" holds the keywords and the help, the details say what the extension does, whether it
	// is built and (since ADR-0026, addendum KL) its keywords as a list of chips. The app cannot see
	// the extension in the browser: the lozenge only says what the app knows (a restart before the
	// migration, no key, no build), never "Verbunden".
	let {
		importKeywords = null,
		inboxKeys = null,
		extension = null,
		setupHref
	}: {
		importKeywords?: ImportKeywordsStore | null;
		/** Keys of the own inbox; the extension needs one. */
		inboxKeys?: InboxKeysStore | null;
		/** Folder of the built extension, null while unknown. */
		extension?: ExtensionInfo | null;
		/** Address of the assistant. */
		setupHref: ResolvedPathname;
	} = $props();

	let editingKeywords = $state(false);

	const keywordList = $derived(
		importKeywords?.state === 'ready' ? importKeywords.settings['whatsapp-web'].keywords : null
	);
	const keywords = $derived(keywordList === null ? null : keywordSummary(keywordList));
	const status = $derived(
		whatsAppWebStatus(
			inboxKeys?.state ?? null,
			inboxKeys?.keys.length ?? 0,
			extension === null ? null : extension.built
		)
	);
	const hint = $derived(
		extension !== null && !extension.built
			? {
					tone: 'warning' as const,
					text: 'Der Ordner der Erweiterung fehlt noch. Er entsteht beim Bauen der App (scripts\\build.ps1).'
				}
			: null
	);

	const primary = $derived<CardAction>({ label: 'Einrichten', href: setupHref, inPlace: true });
	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (importKeywords !== null) {
			entries.push({
				label: 'Stichwörter …',
				dialog: true,
				onselect: () => (editingKeywords = true)
			});
		}
		entries.push({ label: 'Hilfe', href: helpHref('whatsapp-web') });
		return entries;
	});
</script>

<ChannelCard
	icon="whatsapp-web"
	title="WhatsApp Web (Browser-Erweiterung)"
	subtitle="Für Edge und Chrome, liest nur"
	{status}
	info={keywords === null
		? 'Nachrichten aus dem offenen Tab in den Eingang'
		: `Stichwörter für „Automatisch“: ${keywords}`}
	{hint}
	{primary}
	{menu}
>
	{#snippet details()}
		<p>
			Im offenen WhatsApp-Web-Tab legst du Nachrichten mit „In den Eingang“ ab; auf Wunsch kommen
			neue Nachrichten mit Stichwort automatisch. Die Erweiterung sendet nie etwas in WhatsApp.
		</p>
		{#if extension !== null || keywordList !== null}
			<dl>
				{#if extension !== null}
					<div>
						<dt>Erweiterung</dt>
						<dd>
							{extension.built ? `gebaut, Version ${extension.version}` : 'noch nicht gebaut'}
						</dd>
					</div>
				{/if}
				{#if keywordList !== null}
					<div>
						<dt>Stichwörter für „Automatisch“</dt>
						<dd>
							<ChipList
								items={keywordList}
								label="Stichwörter von „WhatsApp Web“"
								noun="Stichwörter"
								emptyText="keine"
							/>
						</dd>
					</div>
				{/if}
			</dl>
		{/if}
	{/snippet}
</ChannelCard>

{#if editingKeywords && importKeywords !== null}
	<ChannelKeywordsModal
		kind="whatsapp-web"
		store={importKeywords}
		onclose={() => (editingKeywords = false)}
	/>
{/if}
