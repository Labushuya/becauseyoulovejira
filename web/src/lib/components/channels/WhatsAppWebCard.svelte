<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { ExtensionInfo } from '$lib/data/extension';
	import { whatsAppWebStatus } from '$lib/domain/channel-card';
	import { keywordSummary } from '$lib/domain/channel-health';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import type { InboxTargetsStore } from '$lib/stores/inbox-targets.svelte';
	import ChipList from '../ChipList.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';
	import ChannelKeywordsModal from './ChannelKeywordsModal.svelte';

	// Card "WhatsApp Web (Browser-Erweiterung)" (ADR-0038 §4, plan eigener-eingang-whatsapp-web EI-3;
	// since the plan kanal-karten KK-2 a configuration of the building block ChannelCard): the main
	// button "Einrichten" opens the assistant in the address (?einrichten=whatsapp-web), the menu
	// "•••" holds the keywords and the help, the details say what the extension does, whether it
	// is built and (since ADR-0026, addendum KL) its keywords as a list of chips. The app cannot see
	// the extension in the browser: the lozenge only says what the app knows (a restart before the
	// migration, no key, no build), never "Verbunden". The target project of its entries (ADR-0049,
	// per user) stands in the details; "Zielprojekt …" in the menu leads there.
	let {
		importKeywords = null,
		inboxKeys = null,
		inboxTargets = null,
		projects = [],
		extension = null,
		setupHref
	}: {
		importKeywords?: ImportKeywordsStore | null;
		/** Keys of the own inbox; the extension needs one. */
		inboxKeys?: InboxKeysStore | null;
		/** Target projects of the cards without a connection (ADR-0049). */
		inboxTargets?: InboxTargetsStore | null;
		/** Every project of the catalog, archived ones included. */
		projects?: readonly ProjectRef[];
		/** Folder of the built extension, null while unknown. */
		extension?: ExtensionInfo | null;
		/** Address of the assistant. */
		setupHref: ResolvedPathname;
	} = $props();

	const TITLE = 'WhatsApp Web (Browser-Erweiterung)';
	const uid = $props.id();
	const targetId = `${uid}-target`;
	let card = $state<ReturnType<typeof ChannelCard>>();
	let editingKeywords = $state(false);
	/** The target is known (ready) or waits for the restart (unavailable); else the row is left out. */
	const targetShown = $derived(
		inboxTargets !== null &&
			(inboxTargets.state === 'ready' || inboxTargets.state === 'unavailable')
	);

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
		if (inboxTargets?.state === 'ready') {
			entries.push({ label: 'Zielprojekt …', onselect: () => void card?.showDetails(targetId) });
		}
		entries.push({ label: 'Hilfe', href: helpHref('whatsapp-web') });
		return entries;
	});
</script>

<ChannelCard
	bind:this={card}
	icon="whatsapp-web"
	title={TITLE}
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
		{#if targetShown && inboxTargets !== null}
			<CardTargetProject
				id={targetId}
				name={TITLE}
				entries="Neue Einträge aus WhatsApp Web"
				value={inboxTargets.targets['whatsapp-web'] || null}
				{projects}
				ready={inboxTargets.state === 'ready'}
				onsave={(project) => inboxTargets.save('whatsapp-web', project, 'WhatsApp Web')}
			/>
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
