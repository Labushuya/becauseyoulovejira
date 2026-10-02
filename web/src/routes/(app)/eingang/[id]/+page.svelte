<script lang="ts">
	import { page } from '$app/state';
	import InboxItemRoute from '$lib/components/InboxItemRoute.svelte';
	import { inboxHref } from '$lib/ticket-links';

	// Panel of one inbox entry (/eingang/<record id>, E4 plan T-3); the parts live in InboxItemRoute,
	// which the calendar shares (/kalender/eingang/<id>, ADR-0054 §8).
</script>

<InboxItemRoute back={inboxHref(page.url)} section="Eingang" />
