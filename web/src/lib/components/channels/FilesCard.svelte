<script lang="ts">
	import { resolve } from '$app/paths';
	import { IMPORT_KINDS, type ImportKind } from '$lib/domain/keywords';
	import type { ProjectRef } from '$lib/domain/ticket';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxTargetsStore } from '$lib/stores/inbox-targets.svelte';
	import ChipList from '../ChipList.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';

	// Card "Dateien hereinziehen" (ADR-0026 section 3, plan EH-3 and EH-7; since the plan
	// kanal-karten KK-2 a configuration of the building block ChannelCard): the file imports of the
	// inbox, mail files (.eml, also from Proton), calendar files (.ics) and WhatsApp exports. They
	// are manual, so the card has no state; its info line counts the keywords per kind, the main
	// button leads to the inbox, the menu "•••" to the page "Datei-Importe" with the guides and
	// the keywords. Since ADR-0026 (addendum KL) the details list the keywords of each kind as a list
	// of chips. The target project of the files (ADR-0049, one for the three kinds, per user) stands
	// in the details; "Zielprojekt …" in the menu leads there.
	let {
		importKeywords = null,
		inboxTargets = null,
		projects = []
	}: {
		importKeywords?: ImportKeywordsStore | null;
		/** Target projects of the cards without a connection (ADR-0049). */
		inboxTargets?: InboxTargetsStore | null;
		/** Every project of the catalog, archived ones included. */
		projects?: readonly ProjectRef[];
	} = $props();

	const TITLE = 'Dateien hereinziehen';
	const uid = $props.id();
	const targetId = `${uid}-target`;
	let card = $state<ReturnType<typeof ChannelCard>>();

	/** Short names of the kinds of file. */
	const FILE_NAMES: Readonly<Record<ImportKind, string>> = {
		eml: 'Mail',
		ics: 'Kalender',
		whatsapp: 'WhatsApp'
	};

	/** Names of the kinds in the details, with the kind of file. */
	const KIND_LABELS: Readonly<Record<ImportKind, string>> = {
		eml: 'Mail (.eml)',
		ics: 'Kalender (.ics)',
		whatsapp: 'WhatsApp-Export'
	};

	const counts = $derived(
		importKeywords?.state === 'ready'
			? IMPORT_KINDS.map(
					(kind) => `${FILE_NAMES[kind]} ${importKeywords.settings[kind].keywords.length}`
				).join(' · ')
			: null
	);
	/** The target is known (ready) or waits for the restart (unavailable); else the row is left out. */
	const targetShown = $derived(
		inboxTargets !== null &&
			(inboxTargets.state === 'ready' || inboxTargets.state === 'unavailable')
	);

	const primary: CardAction = { label: 'Zum Eingang', href: resolve('/eingang') };
	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [
			{ label: 'Anleitungen und Stichwörter', href: resolve('/einstellungen/datei-importe') }
		];
		if (inboxTargets?.state === 'ready') {
			entries.push({ label: 'Zielprojekt …', onselect: () => void card?.showDetails(targetId) });
		}
		return entries;
	});
</script>

<ChannelCard
	bind:this={card}
	icon="files"
	title={TITLE}
	subtitle="Mail (.eml, auch Proton), Kalender (.ics), WhatsApp-Export"
	info={counts === null
		? 'Per Drag & Drop oder „Datei wählen“ im Eingang'
		: `Stichwörter: ${counts}`}
	{primary}
	{menu}
>
	{#snippet details()}
		<p>
			Mail-Dateien (.eml, auch aus Proton), Kalenderdateien (.ics) und WhatsApp-Exporte ziehst du in
			den Eingang oder wählst sie dort mit „Datei wählen“. Treffer deiner Stichwörter sind in der
			Auswahl schon markiert; übernommen wird nur, was du auswählst.
		</p>
		{#if importKeywords?.state === 'ready'}
			<dl>
				{#each IMPORT_KINDS as kind (kind)}
					<div>
						<dt>{KIND_LABELS[kind]}</dt>
						<dd>
							<ChipList
								items={importKeywords.settings[kind].keywords}
								label={`Stichwörter für ${KIND_LABELS[kind]}`}
								noun="Stichwörter"
								emptyText="keine"
							/>
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
		{#if targetShown && inboxTargets !== null}
			<CardTargetProject
				id={targetId}
				name={TITLE}
				entries="Neue Einträge aus Dateien"
				value={inboxTargets.targets.files || null}
				{projects}
				ready={inboxTargets.state === 'ready'}
				onsave={(project) => inboxTargets.save('files', project, TITLE)}
			/>
		{/if}
	{/snippet}
</ChannelCard>
