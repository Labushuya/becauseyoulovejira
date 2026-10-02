<script lang="ts">
	import { page } from '$app/state';
	import InboxItemRoute from '$lib/components/InboxItemRoute.svelte';
	import { calendarHref } from '$lib/ticket-links';

	// Panel of an inbox entry next to the calendar (/kalender/eingang/<id>, ADR-0054 §8): a date of
	// the inbox in the calendar opens its entry here instead of in "Eingang"; × leads back to the
	// calendar with its view, day and filters. The parts are those of /eingang/<id>.
</script>

<InboxItemRoute back={calendarHref(page.url)} section="Kalender" />
