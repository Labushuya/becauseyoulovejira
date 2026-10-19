<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { formatCalendarDate } from '$lib/domain/format';
	import {
		RECURRENCE_FREQS,
		WEEKDAYS,
		INTERVAL_MAX,
		INTERVAL_MIN,
		LEAD_DAYS_MAX,
		LEAD_DAYS_MIN,
		type RecurrenceFreq,
		type Weekday
	} from '$lib/domain/recurrence';
	import {
		CATCH_UP_TODAY_LABEL,
		EACH_MAX_PER_RUN,
		TAKE_DUE_LABEL,
		anchorHint,
		anchorOffer,
		anchorOfferText,
		anchorShown,
		backlogText,
		catchUpAllLabel,
		formBacklog,
		formPreview,
		openBlockText,
		previewRowText,
		previewTicketText,
		previewTitle,
		seriesStartQuestion,
		type RecurrenceFormContext,
		type RecurrenceFormField,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import { liveExample } from '$lib/domain/recurrence-examples';
	import { helpHref } from '$lib/settings-sections';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import { WEEKDAY_NAMES, WEEKDAY_SHORT } from '$lib/domain/recurrence-text';
	import ErrorIcon from './ErrorIcon.svelte';
	import Field from './form/Field.svelte';
	import { findAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';
	import RecurrenceAssignment from './RecurrenceAssignment.svelte';
	import SeriesStartChoice from './SeriesStartChoice.svelte';

	// Fields of a rhythm (E5 plan, package 4), shared by "Wiederholen…", the rule panel and the
	// conversion of a calendar series: kind as a radio group, interval and unit, weekdays as a
	// labelled group of check boxes, day of the month with "Letzter Tag", start and lead time, and
	// the preview "Nächste Termine", which follows every change at once. Field errors stand at their
	// field (aria-invalid, aria-describedby); no state is shown by color alone.
	// With a fixed rhythm and `eachAvailable` (plan OR-5, after its migration) the switch "Jeden
	// Termin einzeln anlegen" follows, off by default, with a hint that says what each state means.
	// Switching it on with more than EACH_MAX_PER_RUN dates before today asks inline whether to
	// catch up all of them or go on from today (ADR-0022 addendum 5); switching it off while several
	// tickets of the rule are open says that the series waits for all of them (recommendation 6).
	// A series whose first date lies in the past (the due date of the ticket, the first date "Beginnt
	// am" gives a ticket without one, or "Beginnt am" of a new rule) shows SeriesStartChoice (WH-2,
	// ADR-0022 addendum 14): with a ticket "Serie ab heute beginnen" (chosen in advance) or
	// "Ursprüngliches Datum behalten", kept in `values.start`.
	// "Zuständigkeit" (E7-5, ADR-0068 §5) follows for a rule of the household once the server knows it
	// (`assignmentAvailable`): none, one fixed person or a rotation, with the preview of the next two.
	// Since RG-1 the fields stand in a Field (ADR-0060: label above, then error and hint), the groups
	// (kind, weekdays) carry a legend in the look of its label, and the weekdays are check boxes like
	// every other choice of several (base.css, ADR-0029 G-5), without boxes of their own.
	// Since RV-1 (ADR-0022 addendum 18) the preview after completion counts from the current due date
	// of the ticket (`context`): "Dieses Ticket: fällig …", "Am Fälligkeitstag erledigt → nächstes
	// erscheint … → fällig …" and, unless that is today, "Heute erledigt → …". There "Beginnt am"
	// gives way (it takes no part); without a ticket it says that it only gives the first due date.
	// Where "Beginnt am" differs from the current due date of the ticket, a hint offers "Fälligkeit
	// übernehmen"; nothing follows by itself. Everything is derived; the button is the only writer.
	let {
		values = $bindable(),
		errors = {},
		today,
		withoutDue = false,
		eachAvailable = false,
		context,
		openKeys = [],
		assignmentAvailable = false,
		assignees = findAssignees()
	}: {
		values: RecurrenceFormValues;
		errors?: Partial<Record<RecurrenceFormField, string>>;
		today: CalendarDate;
		/** The ticket has no due date yet: name the first date it gets (ADR-0023 section 1). */
		withoutDue?: boolean;
		/** The server knows "Jeden Termin einzeln anlegen" (RecurrenceStore.eachReady). */
		eachAvailable?: boolean;
		/** Ticket or rule the form belongs to; without it (a new rule) there is no backlog. */
		context?: RecurrenceFormContext;
		/** Keys of the open tickets of the rule, oldest first. */
		openKeys?: readonly string[];
		/** The server knows the assignment of rules (RecurrenceStore.assigneesReady). */
		assignmentAvailable?: boolean;
		/** The members of the household (the directory of the layout); null without one. */
		assignees?: AssigneeSource | null;
	} = $props();

	/** Only in the household, where a rule gives its tickets a person. */
	const assignmentShown = $derived(
		assignmentAvailable && assignees !== null && assignees.active && assignees.members.length > 0
	);

	const uid = $props.id();
	const idOf = (field: string) => `${uid}-${field}`;
	const errorIdOf = (field: RecurrenceFormField) => `${uid}-${field}-error`;

	const UNIT_LABELS: Readonly<Record<RecurrenceFreq, string>> = {
		daily: 'Tage',
		weekly: 'Wochen',
		monthly: 'Monate',
		yearly: 'Jahre'
	};

	const calendar = $derived(values.mode === 'calendar');
	/** From the current due date of the ticket in `context` (RV-1). */
	const preview = $derived(formPreview(values, today, context, withoutDue));
	const ticketLine = $derived(previewTicketText(preview, today));
	/** "Beginnt am" gives way after completion at a ticket (RV-1); an error at it keeps it. */
	const anchorVisible = $derived(
		anchorShown(values, context, withoutDue) || errors.anchor !== undefined
	);
	/** The current due date of the ticket while "Beginnt am" differs from it (RV-1). */
	const dueOffer = $derived(anchorOffer(values, context));
	let anchorInput = $state<HTMLInputElement>();
	/** Where a series begins whose first date lies in the past (WH-2). */
	const startQuestion = $derived(seriesStartQuestion(values, today, context, withoutDue));
	/** The sentence of "So funktioniert’s" with the dates of these settings. */
	const example = $derived(liveExample(values, today, context));
	/** Days 29 to 31 do not exist in every month: they are clamped (ADR-0021 section 2). */
	const clamped = $derived(!values.lastDay && Number(values.monthDay) >= 29);
	/** Missed dates the switch would make at once (ADR-0022 addendum 5). */
	const backlog = $derived(eachAvailable ? formBacklog(values, today, context) : null);
	/** The switch goes off while several tickets of the rule are open (recommendation 6). */
	const switchedOffWithOpen = $derived(
		eachAvailable &&
			calendar &&
			context?.kind === 'rule' &&
			context.each &&
			values.eachOccurrence !== true &&
			openKeys.length > 1
	);

	function describedBy(field: RecurrenceFormField, hint?: string): string | undefined {
		const ids = [errors[field] ? errorIdOf(field) : '', hint ?? ''].filter((id) => id !== '');
		return ids.length > 0 ? ids.join(' ') : undefined;
	}

	function toggleWeekday(day: Weekday, checked: boolean) {
		const next = checked
			? [...values.weekdays, day]
			: values.weekdays.filter((existing) => existing !== day);
		values.weekdays = WEEKDAYS.filter((candidate) => next.includes(candidate));
	}

	/** "Fälligkeit übernehmen": the due date becomes "Beginnt am"; the hint goes, the focus stays. */
	function takeDue(due: CalendarDate) {
		values.anchor = due;
		anchorInput?.focus();
	}
</script>

{#snippet fieldError(field: RecurrenceFormField)}
	{#if errors[field]}
		<p class="field-error" id={errorIdOf(field)}><ErrorIcon /><span>{errors[field]}</span></p>
	{/if}
{/snippet}

<div class="recurrence-form">
	<fieldset class="group" aria-describedby={describedBy('mode', idOf('mode-hint'))}>
		<legend>Art der Wiederholung</legend>
		<label class="choice">
			<input type="radio" name={idOf('mode')} value="calendar" bind:group={values.mode} />
			Fester Rhythmus
		</label>
		<label class="choice">
			<input type="radio" name={idOf('mode')} value="after_completion" bind:group={values.mode} />
			Nach Erledigung
		</label>
		<p class="hint" id={idOf('mode-hint')}>
			{#if calendar}
				Feste Kalendertage: Früher oder später erledigen ändert die Termine nicht.
			{:else}
				Abstand ab dem Erledigen: Früher oder später erledigen verschiebt den nächsten Termin mit.
			{/if}
		</p>
		{@render fieldError('mode')}
	</fieldset>

	<Field
		label={calendar ? 'Alle' : 'Abstand nach Erledigung'}
		id={idOf('interval')}
		error={errors.interval ?? ''}
		width="auto"
	>
		{#snippet control(field)}
			<div class="inline">
				<input
					{...field}
					class="number"
					type="number"
					inputmode="numeric"
					min={INTERVAL_MIN}
					max={INTERVAL_MAX}
					step="1"
					bind:value={() => values.interval, (value) => (values.interval = String(value ?? ''))}
				/>
				<label class="visually-hidden" for={idOf('freq')}>Einheit</label>
				<select
					id={idOf('freq')}
					bind:value={values.freq}
					aria-invalid={errors.freq ? 'true' : undefined}
					aria-describedby={describedBy('freq')}
				>
					{#each RECURRENCE_FREQS as freq (freq)}
						<option value={freq}>{UNIT_LABELS[freq]}</option>
					{/each}
				</select>
			</div>
		{/snippet}
	</Field>
	{@render fieldError('freq')}

	{#if calendar && values.freq === 'weekly'}
		<fieldset class="group" aria-describedby={describedBy('weekdays')}>
			<legend>Wochentage</legend>
			<div class="days">
				{#each WEEKDAYS as day (day)}
					<label class="choice">
						<input
							type="checkbox"
							checked={values.weekdays.includes(day)}
							aria-invalid={errors.weekdays ? 'true' : undefined}
							onchange={(event) => toggleWeekday(day, event.currentTarget.checked)}
						/>
						<span aria-hidden="true">{WEEKDAY_SHORT[day]}</span>
						<span class="visually-hidden">{WEEKDAY_NAMES[day]}</span>
					</label>
				{/each}
			</div>
			{@render fieldError('weekdays')}
		</fieldset>
	{/if}

	{#if calendar && values.freq === 'monthly'}
		<Field
			label="Tag im Monat"
			id={idOf('monthDay')}
			error={errors.monthDay ?? ''}
			hint={clamped ? 'In kürzeren Monaten am letzten Tag.' : undefined}
			width="auto"
		>
			{#snippet control(field)}
				<div class="inline">
					<input
						{...field}
						class="number"
						type="number"
						inputmode="numeric"
						min="1"
						max="31"
						step="1"
						disabled={values.lastDay}
						bind:value={() => values.monthDay, (value) => (values.monthDay = String(value ?? ''))}
					/>
					<label class="choice">
						<input type="checkbox" bind:checked={values.lastDay} />
						Letzter Tag
					</label>
				</div>
			{/snippet}
		</Field>
	{/if}

	{#if anchorVisible}
		<Field
			label="Beginnt am"
			id={idOf('anchor')}
			error={errors.anchor ?? ''}
			hint={anchorHint(values, context, withoutDue)}
			width="auto"
		>
			{#snippet control(field)}
				<input {...field} type="date" bind:value={values.anchor} bind:this={anchorInput} />
			{/snippet}
		</Field>
		{#if dueOffer !== null}
			{@const due = dueOffer}
			<!-- RV-1: the due date changed while the form is open (or never matched); no silent follow. -->
			<SectionMessage tone="info" compact live>
				{anchorOfferText(due, today)}
				{#snippet actions()}
					<button class="button-secondary button-small" type="button" onclick={() => takeDue(due)}>
						{TAKE_DUE_LABEL}
					</button>
				{/snippet}
			</SectionMessage>
		{/if}
	{/if}

	<Field
		label="Vorlauf (Tage)"
		id={idOf('leadDays')}
		error={errors.leadDays ?? ''}
		hint="So viele Tage vor der Fälligkeit erscheint das nächste Ticket (0 = am Tag selbst, kurz nach Mitternacht)."
		width="auto"
	>
		{#snippet control(field)}
			<input
				{...field}
				class="number"
				type="number"
				inputmode="numeric"
				min={LEAD_DAYS_MIN}
				max={LEAD_DAYS_MAX}
				step="1"
				bind:value={() => values.leadDays, (value) => (values.leadDays = String(value ?? ''))}
			/>
		{/snippet}
	</Field>

	{#if calendar && eachAvailable}
		<div class="option">
			<label class="switch-row" for={idOf('each')}>
				<span>Verpasste Termine nachholen</span>
				<input
					id={idOf('each')}
					type="checkbox"
					role="switch"
					checked={values.eachOccurrence === true}
					aria-invalid={errors.eachOccurrence ? 'true' : undefined}
					aria-describedby={describedBy('eachOccurrence', idOf('each-hint'))}
					onchange={(event) => (values.eachOccurrence = event.currentTarget.checked)}
				/>
			</label>
			<p class="hint" id={idOf('each-hint')}>
				{#if values.eachOccurrence === true}
					Jeder Termin bekommt ein eigenes Ticket, auch wenn frühere noch offen sind, und jedes
					zählt (etwa für Miete). Fehlen mehr als
					{EACH_MAX_PER_RUN} Termine (etwa weil die App aus war), fragt die Regel vorher, ob sie alle
					nachholt.
				{:else}
					Nur das aktuelle Ticket zählt: Bleibt es liegen, zeigt es „überfällig seit …“, und das
					nächste entsteht erst beim Erledigen, für den nächsten Termin danach. Verpasste Termine
					gelten als übersprungen.
				{/if}
			</p>
			{@render fieldError('eachOccurrence')}
		</div>
		{#if backlog !== null}
			<SectionMessage tone="warning" compact>
				<fieldset class="group backlog">
					<legend>{backlogText(backlog, today)} liegen vor heute</legend>
					<p class="note">
						So viele legt die App nicht von selbst an. Ohne Wahl wartet die Regel in der Übersicht
						auf deine Entscheidung.
					</p>
					<label class="choice">
						<input type="radio" name={idOf('backlog')} value="all" bind:group={values.backlog} />
						{catchUpAllLabel(backlog)} (höchstens {EACH_MAX_PER_RUN} je Stunde)
					</label>
					<label class="choice">
						<input type="radio" name={idOf('backlog')} value="today" bind:group={values.backlog} />
						{CATCH_UP_TODAY_LABEL}
					</label>
				</fieldset>
			</SectionMessage>
		{/if}
		{#if switchedOffWithOpen}
			<SectionMessage tone="info" compact>{openBlockText(openKeys)}</SectionMessage>
		{/if}
	{/if}

	<!-- Each date with the day its ticket appears, so the lead time shows (plan "Wiederholungen
	     verständlich machen": "erscheint … → fällig …"); after completion each row starts with the
	     day of the completion it assumes (RV-1). -->
	<div class="preview" aria-live="polite">
		{#if preview.rows.length === 0}
			<p>Nächste Termine erscheinen, sobald alle Angaben stimmen.</p>
		{:else}
			<p class="preview-title">{previewTitle(values)}</p>
			{#if ticketLine !== null}
				<p class="preview-ticket" data-due={preview.ticketDue}>{ticketLine}</p>
			{/if}
			<ol class="preview-rows" class:completion={!calendar}>
				{#each preview.rows as row (row.completed ?? row.due)}
					{@const text = previewRowText(row, preview, today)}
					<li data-due={row.due} data-completed={row.completed}>
						{#if text.completed !== null}
							<span class="completed">{text.completed}</span>
							<span class="arrow" aria-hidden="true">→</span>
						{/if}
						<span class="appears">{text.appears}</span>
						<span class="arrow" aria-hidden="true">→</span>
						<span class="due">{text.due}</span>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
	{#if startQuestion !== null}
		<!-- WH-2 (before: recommendation 4, only a warning): a start in the past, begin from today? -->
		<SeriesStartChoice
			question={startQuestion}
			{today}
			value={values.start}
			onchoose={(start) => (values.start = start)}
		/>
	{:else if preview.firstDue !== null}
		<p class="note">
			Das Ticket hat noch keine Fälligkeit und bekommt den ersten Termin: {formatCalendarDate(
				preview.firstDue
			)}.
		</p>
	{/if}

	{#if assignmentShown && assignees !== null}
		<!-- "Zuständigkeit" of the next tickets (ADR-0068 §5), only for a rule of the household. -->
		<RecurrenceAssignment
			bind:value={values.assignment}
			members={assignees.members}
			context={assignees.context}
			error={errors.assignees ?? null}
			errorId={errorIdOf('assignees')}
		/>
	{/if}

	<!-- "So funktioniert’s" (plan "Wiederholungen verständlich machen", part A): what the chosen kind
	     and the switch mean, and a sentence with the dates of these very settings. Folded by default;
	     the help opens in a new tab, so nothing typed here is lost. -->
	<details class="how">
		<summary>So funktioniert’s</summary>
		<SectionMessage tone="info" compact>
			<p>
				{#if calendar}
					Fester Rhythmus heißt: An festen Kalendertagen ist es dran. Früher oder später erledigen
					ändert die Termine nicht.
				{:else}
					Nach Erledigung heißt: Der nächste Termin zählt ab dem Tag, an dem du erledigst. Früher
					oder später erledigen verschiebt ihn mit.
				{/if}
				Das Ticket erscheint so viele Tage vor der Fälligkeit, wie der Vorlauf sagt.
				{#if calendar && values.eachOccurrence === true}
					Jeder Termin bekommt ein eigenes Ticket, auch wenn frühere noch offen sind.
				{:else}
					Solange ein Ticket der Serie offen ist, entsteht kein weiteres.
				{/if}
			</p>
			{#if example !== null}
				<p class="example">{example}</p>
			{/if}
			<p>
				<a href={helpHref('wiederholungen')} target="_blank" rel="noopener"
					>Mehr Beispiele in der Hilfe (neuer Tab)</a
				>
			</p>
		</SectionMessage>
	</details>
</div>

<style>
	.recurrence-form {
		display: grid;
		gap: 0.875rem;
	}

	.group {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: none;
	}

	/* The legend of a group in the look of the label of a Field (ADR-0060). */
	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	/* A switch with its hint and error, in the gaps of a Field. */
	.option {
		display: grid;
		gap: 0.25rem;
	}

	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	/* The weekdays side by side like other choices of several; they wrap on narrow columns. */
	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
	}

	.number {
		width: 5rem;
	}

	/* Name left, switch right, like "Glas-Effekt" (ADR-0029, G-5). */
	.switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		max-width: 26rem;
		font-size: var(--font-size-body);
		font-weight: 400;
		cursor: pointer;
	}

	.hint,
	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.preview {
		display: grid;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		font-size: var(--font-size-control);
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.preview-title {
		font-weight: 600;
	}

	/* Two columns: when the ticket appears, then its due date; the lead time is the gap. */
	.preview-rows {
		display: grid;
		grid-template-columns: max-content max-content 1fr;
		gap: 0.125rem 0.5rem;
		padding: 0;
		list-style: none;
	}

	/* Rows keep their list semantics (no display: contents) and line up through the subgrid. */
	.preview-rows li {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
	}

	/* After completion (RV-1) at most two rows of five parts: they wrap in narrow columns (the card
	   of the full view) instead of lining up. */
	.preview-rows.completion {
		grid-template-columns: minmax(0, 1fr);
	}

	.preview-rows.completion li {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
	}

	.completed,
	.appears,
	.arrow {
		color: var(--color-text-muted);
	}

	.due {
		font-variant-numeric: tabular-nums;
	}

	.how {
		font-size: var(--font-size-control);
	}

	.how summary {
		width: fit-content;
		font-weight: 600;
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.how[open] summary {
		margin-bottom: 0.375rem;
	}

	.how p + p {
		margin-top: 0.375rem;
	}

	.how a {
		color: var(--color-brand-text);
	}
</style>
