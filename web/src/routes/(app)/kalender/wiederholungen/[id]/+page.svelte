<script lang="ts">
	import { page } from '$app/state';
	import RuleRoute from '$lib/components/RuleRoute.svelte';
	import { calendarHref } from '$lib/ticket-links';

	// Panel of a rule next to the calendar (/kalender/wiederholungen/<id>, ADR-0054 §8): a planned
	// date of the calendar opens its rule here instead of in "Wiederholungen"; × leads back to the
	// calendar with its view, day and filters. The parts are those of /wiederholungen/<id>.
</script>

<RuleRoute back={calendarHref(page.url)} section="Kalender" />
