<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		SERIES_START_KEEP_LABEL,
		SERIES_START_TODAY_LABEL,
		firstOccurrenceText,
		keepStartText,
		seriesStartText,
		type SeriesStartQuestion
	} from '$lib/domain/recurrence-rule';
	import { DEFAULT_SERIES_START, type SeriesStart } from '$lib/domain/series-start';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// A series whose first date lies in the past (WH-2, ADR-0022 addendum 14), the same on every way
	// a rule is created (RecurrenceForm: "Wiederholen…", "Neues Ticket", a calendar series, "Neue
	// Regel"). With a ticket it asks, as a warning without red like the question about a backlog:
	// "Serie ab heute beginnen" (chosen in advance) with the date the series then begins on, or
	// "Ursprüngliches Datum behalten" (the ticket stays overdue). A new rule has no ticket to keep and
	// begins from today on the server anyway, so the hint only says so.
	let {
		question,
		today,
		value,
		onchoose
	}: {
		question: SeriesStartQuestion;
		today: CalendarDate;
		/** The choice; absent counts as DEFAULT_SERIES_START. */
		value: SeriesStart | undefined;
		onchoose: (value: SeriesStart) => void;
	} = $props();

	const uid = $props.id();
	const chosen = $derived(value ?? DEFAULT_SERIES_START);
</script>

{#if question.choice}
	<SectionMessage tone="warning" compact>
		<fieldset class="series-start">
			<legend>{seriesStartText(question)}</legend>
			<label class="choice">
				<input
					type="radio"
					name={uid}
					value="today"
					checked={chosen === 'today'}
					aria-describedby={`${uid}-today`}
					onchange={() => onchoose('today')}
				/>
				{SERIES_START_TODAY_LABEL}
			</label>
			<p class="note" id={`${uid}-today`}>{firstOccurrenceText(question, today)}</p>
			<label class="choice">
				<input
					type="radio"
					name={uid}
					value="keep"
					checked={chosen === 'keep'}
					aria-describedby={`${uid}-keep`}
					onchange={() => onchoose('keep')}
				/>
				{SERIES_START_KEEP_LABEL}
			</label>
			<p class="note" id={`${uid}-keep`}>{keepStartText(question, today)}</p>
		</fieldset>
	</SectionMessage>
{:else}
	<SectionMessage tone="info" compact>
		{seriesStartText(question)} Die Serie beginnt ab heute. {firstOccurrenceText(question, today)}.
	</SectionMessage>
{/if}

<style>
	.series-start {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		width: fit-content;
		font-size: var(--font-size-body);
	}

	/* The date each choice gives, below its name and in line with it. */
	.note {
		padding-left: 1.375rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
