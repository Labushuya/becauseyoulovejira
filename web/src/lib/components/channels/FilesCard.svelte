<script lang="ts">
	import { resolve } from '$app/paths';
	import { IMPORT_KINDS, type ImportKind } from '$lib/domain/keywords';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';

	// Card "Dateien hereinziehen" (ADR-0026 section 3, plan EH-3 and EH-7; since the plan
	// kanal-karten KK-2 a configuration of the building block ChannelCard): the file imports of the
	// inbox, mail files (.eml, also from Proton), calendar files (.ics) and WhatsApp exports. They
	// are manual, so the card has no state; its info line counts the keywords per kind, the main
	// button leads to the inbox, the menu "•••" to the page "Datei-Importe" with the guides and
	// the keywords.
	let { importKeywords = null }: { importKeywords?: ImportKeywordsStore | null } = $props();

	/** Short names of the kinds of file. */
	const FILE_NAMES: Readonly<Record<ImportKind, string>> = {
		eml: 'Mail',
		ics: 'Kalender',
		whatsapp: 'WhatsApp'
	};

	const counts = $derived(
		importKeywords?.state === 'ready'
			? IMPORT_KINDS.map(
					(kind) => `${FILE_NAMES[kind]} ${importKeywords.settings[kind].keywords.length}`
				).join(' · ')
			: null
	);

	const primary: CardAction = { label: 'Zum Eingang', href: resolve('/eingang') };
	const menu: CardAction[] = [
		{ label: 'Anleitungen und Stichwörter', href: resolve('/einstellungen/datei-importe') }
	];
</script>

<ChannelCard
	icon="files"
	title="Dateien hereinziehen"
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
	{/snippet}
</ChannelCard>
