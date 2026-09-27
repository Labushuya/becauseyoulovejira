<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import SyncAllButton from '$lib/components/SyncAllButton.svelte';
	import { SyncAllStore, syncAllData } from '$lib/stores/sync-all.svelte';
	import BulkConvertDialog from '$lib/components/BulkConvertDialog.svelte';
	import ClipboardImport from '$lib/components/ClipboardImport.svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FileImportDialog from '$lib/components/FileImportDialog.svelte';
	import InboxTable from '$lib/components/InboxTable.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import WhatsAppImport from '$lib/components/WhatsAppImport.svelte';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { parseInboxQuery } from '$lib/domain/inbox-query';
	import { pastedText, readClipboardText } from '$lib/clipboard';
	import { readMailFile } from '$lib/mail-file';
	import { getImportKeywords } from '$lib/data/import-keywords';
	import { lookupDrafts, previewCalendarFile } from '$lib/data/inbox';
	import { EMPTY_IMPORT_KEYWORDS, type ImportKeywords } from '$lib/domain/keywords';
	import {
		importSummary,
		prepareDroppedFiles,
		saveFileSelection,
		type ChatSelection,
		type FileImportResult,
		type FileSelection
	} from '$lib/stores/mail-import';
	import {
		channelSetupHref,
		connectionCardHref,
		inboxItemHref,
		ticketPath
	} from '$lib/ticket-links';
	import { pb } from '$lib/pocketbase';
	import { BulkConverter, bulkConvertData } from '$lib/stores/bulk-convert.svelte';
	import { draftsSummary, saveDrafts, type DraftsOutcome } from '$lib/stores/capture';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { readWhatsAppFile } from '$lib/whatsapp-file';

	// Inbox view (E4 plan, T-3 and package 3): the table with the chips of the URL on the left, the
	// panel of an entry (/eingang/<id>) on the right, like the ticket view (ADR-0010 section 1).
	// "Gesammelt umwandeln" opens a modal dialog; its tickets join the list at once. Results of
	// imports and conversions go out as flags (ADR-0025 section 8): success, or neutral when a part
	// failed (the drop zone and the dialogs name the reasons).
	let { children } = $props();

	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const flags = getFlagStore();
	const query = $derived(parseInboxQuery(page.url.searchParams));
	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/eingang');

	const converter = new BulkConverter(bulkConvertData(pb), auth, {
		upsertTicket: (ticket) => tickets.upsert(ticket),
		markConverted: (id, ticketId, at) => inbox.markConverted(id, ticketId, at)
	});

	// "Alle Kanäle jetzt abrufen" (package A, item 4): new entries arrive through the realtime
	// subscription of the inbox store; the flag leads to the card of a connection that failed.
	const syncAll = new SyncAllStore(syncAllData(pb), auth, flags, {
		card: (id) => void goto(connectionCardHref(id)),
		channels: () => void goto(channelSetupHref(null))
	});

	/** Chosen new entries (checkboxes of the table). */
	let selected = $state<string[]>([]);
	/** Entries of the open dialog, null while it is closed. */
	let bulkItems = $state<Pick<InboxItemSummary, 'id' | 'title'>[] | null>(null);

	// Follows the chips of the URL (reload, back and forward included). untrack: only the URL
	// triggers it, not the store state that activate() reads.
	$effect(() => {
		const current = query;
		untrack(() => inbox.activate(current));
	});

	// The hint on possible duplicates compares with the open tickets, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));

	function openBulk() {
		bulkItems = inbox.visible
			.filter((item) => item.state === 'new' && selected.includes(item.id))
			.map(({ id, title }) => ({ id, title }));
	}

	/** Text for the dialog "Aus der Zwischenablage", null while it is closed. */
	let clipboardText = $state<string | null>(null);
	let clipboardHint = $state<string | null>(null);

	// "Aus Zwischenablage" (E4 plan, package 6): reading needs the permission of the browser; if
	// it refuses, the hint names Ctrl+V, which works through the paste event without one.
	async function fromClipboard() {
		clipboardHint = null;
		const read = await readClipboardText();
		if (read.ok) clipboardText = read.text;
		else clipboardHint = read.message;
	}

	/** Ctrl+V in the inbox view, unless the user pastes into a field or a dialog is open. */
	function onpaste(event: ClipboardEvent) {
		if (clipboardText !== null || bulkItems !== null || chat !== null || selection !== null) return;
		const text = pastedText(event);
		if (text === null) return;
		event.preventDefault();
		clipboardHint = null;
		clipboardText = text;
	}

	function announceDrafts(outcome: DraftsOutcome | null) {
		if (outcome === null || outcome.created + outcome.duplicates === 0) return;
		const tone = outcome.failures.length > 0 ? 'info' : 'success';
		flags.show({ tone, title: draftsSummary(outcome) });
	}

	function announceImport(results: readonly FileImportResult[]) {
		const tone = results.some((result) => result.kind === 'error') ? 'info' : 'success';
		flags.show({ tone, title: importSummary(results) });
	}

	function closeClipboard(outcome: DraftsOutcome | null) {
		clipboardText = null;
		announceDrafts(outcome);
	}

	// Mail and calendar files and WhatsApp exports (E4 plan, packages 8, 14, 16 and 21): dropped on
	// the zone or anywhere in the inbox view, or chosen with "Datei wählen". Mails and events open
	// one selection view with the keyword matches chosen (ADR-0020), a chat export its own view
	// afterwards. Files that cannot be read keep their reason in the drop zone.
	let importing = $state(false);
	let importResults = $state<FileImportResult[]>([]);
	/** Mails and events of the open selection view, null while it is closed. */
	let selection = $state<FileSelection | null>(null);
	/** Chat export of the open selection view, null while it is closed. */
	let chat = $state<ChatSelection | null>(null);
	/** Chat export that waits until the selection of the other files is closed. */
	let pendingChat: ChatSelection | null = null;
	let importKeywords = $state<ImportKeywords>(EMPTY_IMPORT_KEYWORDS);

	async function importFiles(files: File[]) {
		if (importing || chat !== null || selection !== null) return;
		if (!auth.ensureValid()) return;
		importing = true;
		importResults = [];
		const prepared = await prepareDroppedFiles(files, {
			read: readMailFile,
			readChat: readWhatsAppFile,
			previewCalendar: (file) => previewCalendarFile(pb, file),
			lookup: (drafts) => lookupDrafts(pb, drafts),
			keywords: () => getImportKeywords(pb),
			onSessionLost: () => auth.logout()
		});
		importing = false;
		importResults = prepared.results;
		importKeywords = prepared.keywords;
		if (prepared.results.length > 0 && prepared.selection === null) {
			announceImport(prepared.results);
		}
		if (prepared.selection !== null) {
			selection = prepared.selection;
			pendingChat = prepared.chat;
		} else {
			chat = prepared.chat;
		}
	}

	function saveSelection(current: FileSelection, chosen: ReadonlySet<string>) {
		return saveFileSelection(current, chosen, {
			createItem: (draft) => inbox.create(draft),
			importCalendar: (file, select) => inbox.importCalendar(file, select)
		});
	}

	function closeSelection(saved: FileImportResult[] | null) {
		selection = null;
		if (saved !== null) {
			importResults = [...importResults, ...saved];
			announceImport(importResults);
		} else if (importResults.length > 0) {
			announceImport(importResults);
		}
		chat = pendingChat;
		pendingChat = null;
	}

	function closeChat(outcome: DraftsOutcome | null) {
		chat = null;
		announceDrafts(outcome);
	}

	function carriesFiles(event: DragEvent): boolean {
		return [...(event.dataTransfer?.types ?? [])].includes('Files');
	}

	/** Files dropped outside the zone would open in the browser; they are taken in as well. */
	function ondragover(event: DragEvent) {
		if (carriesFiles(event)) event.preventDefault();
	}

	function ondrop(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length > 0) void importFiles(files);
	}

	/** The modal returns the focus to "Gesammelt umwandeln" (ADR-0025 section 3). */
	function closeBulk() {
		const converted = converter.converted;
		bulkItems = null;
		selected = selected.filter((id) => inbox.find(id)?.state === 'new');
		if (converted > 0) {
			const title =
				converted === 1 ? '1 Eintrag umgewandelt.' : `${converted} Einträge umgewandelt.`;
			flags.show({ tone: converter.failed.length > 0 ? 'info' : 'success', title });
		}
	}
</script>

<svelte:document {onpaste} {ondragover} {ondrop} />

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<InboxTable
			store={inbox}
			{flags}
			openTickets={tickets.open}
			{activeId}
			projectsNewCount={tickets.newInProjects}
			bind:selected
			onbulk={openBulk}
			onclipboard={fromClipboard}
			{clipboardHint}
		>
			{#snippet actions()}
				<SyncAllButton store={syncAll} />
			{/snippet}
			{#snippet tools()}
				<DropZone
					busy={importing}
					results={importResults}
					onfiles={(files) => void importFiles(files)}
					itemHref={(id) => inboxItemHref(id, page.url)}
					ticketHref={ticketPath}
				/>
			{/snippet}
		</InboxTable>
	{/snippet}
	{@render children()}
</ViewWithPanel>

{#if clipboardText !== null}
	<ClipboardImport
		text={clipboardText}
		onsave={(drafts) => saveDrafts(drafts, (draft) => inbox.create(draft))}
		onclose={closeClipboard}
	/>
{/if}

{#if selection !== null}
	<FileImportDialog
		{selection}
		onsave={(chosen) => saveSelection(selection as FileSelection, chosen)}
		onclose={closeSelection}
	/>
{/if}

{#if chat !== null}
	<WhatsAppImport
		chat={chat.chat}
		messages={chat.messages}
		leftOut={chat.leftOut}
		keywords={importKeywords.whatsapp.keywords}
		onsave={(drafts) => saveDrafts(drafts, (draft) => inbox.create(draft))}
		onclose={closeChat}
	/>
{/if}

{#if bulkItems !== null}
	<BulkConvertDialog
		items={bulkItems}
		{converter}
		projects={catalog.activeProjects}
		tags={catalog.tags}
		oncreatetag={(name) => catalog.ensureTag(name)}
		onclose={closeBulk}
	/>
{/if}
