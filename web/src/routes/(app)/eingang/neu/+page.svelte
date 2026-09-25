<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CaptureForm from '$lib/components/CaptureForm.svelte';
	import { MANUAL_ORIGIN } from '$lib/domain/ticket';
	import { templateFrom } from '$lib/domain/templates';
	import { saveCapture, type CaptureDeps } from '$lib/stores/capture';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { inboxHref, inboxItemHref, ticketPath, withTemplate } from '$lib/ticket-links';

	// Capture by template (E4 plan, T-3 and package 5): the form in the panel of the inbox view.
	// The chosen template stays in the URL (?vorlage=), so reload and back keep it. A ticket is
	// created with source "manual" and counts as read; an inbox entry gets channel "manual".
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const detail = getTicketDetailStore();
	const tickets = getTicketListStore();
	const template = $derived(templateFrom(page.url.searchParams));

	const deps: CaptureDeps = {
		ensureTag: (name) => catalog.ensureTag(name),
		createTicket: async (draft) => {
			const result = await detail.create(draft, MANUAL_ORIGIN);
			// The form stays open for the next object; the panel store does not follow the ticket.
			if (result.ok) detail.reset();
			return result;
		},
		createItem: (draft) => inbox.create(draft),
		markRead: (ticket) => tickets.markRead(ticket)
	};
</script>

<svelte:head>
	<title>Erfassen · Eingang · becauseyoulovejira</title>
</svelte:head>

<CaptureForm
	{template}
	projects={catalog.activeProjects}
	tags={catalog.tags}
	oncreatetag={(name) => catalog.ensureTag(name)}
	ontemplate={(next) =>
		goto(withTemplate(page.url, next), { replaceState: true, keepFocus: true, noScroll: true })}
	onsave={(capture, target) => saveCapture(capture, target, deps)}
	onclose={() => goto(inboxHref(page.url))}
	resultHref={(target, id) => (target === 'ticket' ? ticketPath(id) : inboxItemHref(id, page.url))}
/>
