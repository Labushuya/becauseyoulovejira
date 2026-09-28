<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CaptureForm from '$lib/components/CaptureForm.svelte';
	import { bookmarkletValues } from '$lib/domain/bookmarklet';
	import { MANUAL_ORIGIN } from '$lib/domain/ticket';
	import { TEMPLATE_PARAM, templateFrom, type CaptureInput } from '$lib/domain/templates';
	import { saveCapture, type CaptureDeps } from '$lib/stores/capture';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { inboxHref, inboxItemHref, withTemplate } from '$lib/ticket-links';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';

	// Ticket links open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();

	// Capture by template (E4 plan, T-3 and package 5): the form in the panel of the inbox view.
	// The chosen template stays in the URL (?vorlage=), so reload and back keep it. A ticket is
	// created with source "manual" and counts as read; an inbox entry gets channel "manual".
	// The bookmarklet (package 7) opens this page with url, titel and auswahl: the form comes
	// filled as "Web-Link" and saves only on a click, never on opening.
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const detail = getTicketDetailStore();
	const tickets = getTicketListStore();
	const clipped = $derived(bookmarkletValues(page.url.searchParams));
	// A template chosen in the URL wins; a page from the bookmarklet is a web link.
	const template = $derived(
		clipped !== null && !page.url.searchParams.has(TEMPLATE_PARAM)
			? 'link'
			: templateFrom(page.url.searchParams)
	);
	const initial = $derived<Partial<CaptureInput>>(
		clipped === null
			? {}
			: { url: clipped.url ?? '', what: clipped.title, excerpt: clipped.selection }
	);
	const hint = $derived(
		clipped?.refusedUrl
			? 'Die Adresse der Seite ist kein http- oder https-Link und wurde nicht übernommen.'
			: null
	);

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

{#key page.url.searchParams.get('url')}
	<CaptureForm
		{template}
		{initial}
		{hint}
		projects={catalog.activeProjects}
		tags={catalog.tags}
		oncreatetag={(name) => catalog.ensureTag(name)}
		ontemplate={(next) =>
			goto(withTemplate(page.url, next), { replaceState: true, keepFocus: true, noScroll: true })}
		onsave={(capture, target) => saveCapture(capture, target, deps)}
		onsavepage={(id, title) => inbox.savePage({ id, title })}
		onclose={() => goto(inboxHref(page.url))}
		resultHref={(target, id) =>
			target === 'ticket' ? links.path(id) : inboxItemHref(id, page.url)}
	/>
{/key}
