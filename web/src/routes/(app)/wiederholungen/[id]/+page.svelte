<script lang="ts">
	import RuleRoute from '$lib/components/RuleRoute.svelte';
	import { recurrencesHref } from '$lib/ticket-links';

	// Panel of one rule (/wiederholungen/<record id>, E5 plan, T-6 and package 5); the parts live in
	// RuleRoute, which the calendar shares (/kalender/wiederholungen/<id>, ADR-0054 §8).
</script>

<RuleRoute back={recurrencesHref()} section="Wiederholungen" />
