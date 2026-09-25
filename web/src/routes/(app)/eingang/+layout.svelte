<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import BulkConvertDialog from '$lib/components/BulkConvertDialog.svelte';
	import ClipboardImport from '$lib/components/ClipboardImport.svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import InboxTable, { BULK_BUTTON_ID } from '$lib/components/InboxTable.svelte';
	import WhatsAppImport from '$lib/components/WhatsAppImport.svelte';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { parseInboxQuery } from '$lib/domain/inbox-query';
	import { pastedText, readClipboardText } from '$lib/clipboard';
	import { readMailFile } from '$lib/mail-file';
	import {
		importDroppedFiles,
		importSummary,
		type ChatSelection,
		type FileImportResult
	} from '$lib/stores/mail-import';
	import { inboxItemHref, ticketPath } from '$lib/ticket-links';
	import { pb } from '$lib/pocketbase';
	import { BulkConverter, bulkConvertData } from '$lib/stores/bulk-convert.svelte';
	import { draftsSummary, saveDrafts, type DraftsOutcome } from '$lib/stores/capture';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { readWhatsAppFile } from '$lib/whatsapp-file';

	// Inbox view (E4 plan, T-3 and package 3): the table with the chips of the URL on the left, the
	// panel of an entry (/eingang/<id>) on the right, like the ticket view (ADR-0010 section 1).
	// "Gesammelt umwandeln" opens a modal dialog; its tickets join the list at once.
	let { children } = $props();

	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const query = $derived(parseInboxQuery(page.url.searchParams));
	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/eingang');

	const converter = new BulkConverter(bulkConvertData(pb), auth, {
		upsertTicket: (ticket) => tickets.upsert(ticket),
		markConverted: (id, ticketId, at) => inbox.markConverted(id, ticketId, at)
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
			.filter(
				(item) => item.state === 'new' && !inbox.isLingering(item.id) && selected.includes(item.id)
			)
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
		if (clipboardText !== null || bulkItems !== null || chat !== null) return;
		const text = pastedText(event);
		if (text === null) return;
		event.preventDefault();
		clipboardHint = null;
		clipboardText = text;
	}

	function closeClipboard(outcome: DraftsOutcome | null) {
		clipboardText = null;
		if (outcome !== null && outcome.created + outcome.duplicates > 0) {
			inbox.announce(draftsSummary(outcome));
		}
	}

	// Mail and calendar files and WhatsApp exports (E4 plan, packages 8, 14 and 16): dropped on the
	// zone or anywhere in the inbox view, or chosen with "Datei wählen"; one after the other, each
	// with its own result. A chat export opens the selection view afterwards.
	let importing = $state(false);
	let importResults = $state<FileImportResult[]>([]);
	/** Chat export of the open selection view, null while it is closed. */
	let chat = $state<ChatSelection | null>(null);

	async function importFiles(files: File[]) {
		if (importing || chat !== null) return;
		importing = true;
		importResults = [];
		const imported = await importDroppedFiles(files, {
			read: readMailFile,
			createItem: (draft) => inbox.create(draft),
			importCalendar: (file) => inbox.importCalendar(file),
			readChat: readWhatsAppFile
		});
		importing = false;
		importResults = imported.results;
		if (imported.results.length > 0) inbox.announce(importSummary(imported.results));
		chat = imported.chat;
	}

	function closeChat(outcome: DraftsOutcome | null) {
		chat = null;
		if (outcome !== null && outcome.created + outcome.duplicates > 0) {
			inbox.announce(draftsSummary(outcome));
		}
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

	async function closeBulk() {
		const converted = converter.converted;
		bulkItems = null;
		selected = selected.filter((id) => inbox.find(id)?.state === 'new');
		if (converted > 0) {
			inbox.announce(
				converted === 1 ? '1 Eintrag umgewandelt.' : `${converted} Einträge umgewandelt.`
			);
		}
		await tick();
		document.getElementById(BULK_BUTTON_ID)?.focus();
	}
</script>

<svelte:document {onpaste} {ondragover} {ondrop} />

<div class="inbox" class:with-panel={withPanel}>
	<InboxTable
		store={inbox}
		openTickets={tickets.open}
		{activeId}
		projectsNewCount={tickets.newInProjects}
		bind:selected
		onbulk={openBulk}
		onclipboard={fromClipboard}
		{clipboardHint}
	>
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
	{@render children()}
</div>

{#if clipboardText !== null}
	<ClipboardImport
		text={clipboardText}
		onsave={(drafts) => saveDrafts(drafts, (draft) => inbox.create(draft))}
		onclose={closeClipboard}
	/>
{/if}

{#if chat !== null}
	<WhatsAppImport
		chat={chat.chat}
		messages={chat.messages}
		leftOut={chat.leftOut}
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

<style>
	.inbox {
		display: grid;
		gap: 1.5rem;
		align-items: start;
	}

	@media (min-width: 48rem) {
		.with-panel {
			grid-template-columns: minmax(0, 1fr) 32rem;
		}
	}
</style>
