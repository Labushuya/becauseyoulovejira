<script lang="ts">
	import {
		ticketLinks,
		setTicketOpenMode,
		type TicketOpenModeStore
	} from '$lib/stores/open-mode.svelte';
	import { setTicketHost, type TicketHost } from '$lib/ticket-host';

	// Test harness of `ticketLinks()` (ticket-host.test.ts, ADR-0054): a component below a host and
	// the store of the remembered mode, with one link of `href` (the state of `url`) and one of
	// `path` (the current address).
	let {
		id,
		url,
		host = null,
		openMode = null
	}: {
		id: string;
		url: URL;
		host?: TicketHost | null;
		openMode?: TicketOpenModeStore | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	if (host !== null) setTicketHost(host);
	// svelte-ignore state_referenced_locally
	if (openMode !== null) setTicketOpenMode(openMode);

	const links = ticketLinks();
</script>

<a href={links.href(id, url)}>href</a>
<a href={links.path(id)}>path</a>
