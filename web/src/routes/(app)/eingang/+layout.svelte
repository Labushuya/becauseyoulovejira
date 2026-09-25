<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import BulkConvertDialog from '$lib/components/BulkConvertDialog.svelte';
	import InboxTable, { BULK_BUTTON_ID } from '$lib/components/InboxTable.svelte';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { parseInboxQuery } from '$lib/domain/inbox-query';
	import { pb } from '$lib/pocketbase';
	import { BulkConverter, bulkConvertData } from '$lib/stores/bulk-convert.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

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

<div class="inbox" class:with-panel={withPanel}>
	<InboxTable store={inbox} openTickets={tickets.open} {activeId} bind:selected onbulk={openBulk} />
	{@render children()}
</div>

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
