<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		CATCH_UP_TODAY_LABEL,
		EACH_MAX_PER_RUN,
		backlogText,
		catchUpAllLabel,
		ruleBacklog,
		type BacklogChoice,
		type RecurrenceRule
	} from '$lib/domain/recurrence-rule';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// A rule with "Jeden Termin einzeln anlegen" that waits for a choice (ADR-0022 addendum 5): more
	// than EACH_MAX_PER_RUN dates before today have no ticket, so the server made none of them. The
	// question names how many and which, and offers "Alle N nachholen" (then in batches) or "Nur
	// ab heute". A warning without red (ADR-0009), inline in the rule panel and in the line
	// "Wiederholt sich" of its tickets; no dialog, and the focus never moves because of it.
	let {
		rule,
		today,
		busy = false,
		ondecide
	}: {
		rule: RecurrenceRule;
		today: CalendarDate;
		busy?: boolean;
		ondecide: (choice: BacklogChoice) => void;
	} = $props();

	const backlog = $derived(ruleBacklog(rule, today));

	function decide(choice: BacklogChoice) {
		if (!busy) ondecide(choice);
	}
</script>

<SectionMessage tone="warning" title="Wartet auf deine Entscheidung" headingLevel={4}>
	<p>
		{#if backlog === null}
			Die Regel hat Termine vor heute nicht angelegt.
		{:else}
			{backlogText(backlog, today)} haben noch kein Ticket, etwa weil die App aus war.
		{/if}
		Mehr als {EACH_MAX_PER_RUN} legt die App nicht von selbst an. Sollen alle nachgeholt werden (höchstens
		{EACH_MAX_PER_RUN} je Stunde) oder geht es erst ab heute weiter?
	</p>
	{#snippet actions()}
		<button
			class="button-secondary"
			type="button"
			aria-disabled={busy ? 'true' : undefined}
			onclick={() => decide('all')}
		>
			{backlog === null ? 'Alle nachholen' : catchUpAllLabel(backlog)}
		</button>
		<button
			class="button-secondary"
			type="button"
			aria-disabled={busy ? 'true' : undefined}
			onclick={() => decide('today')}
		>
			{CATCH_UP_TODAY_LABEL}
		</button>
	{/snippet}
</SectionMessage>
