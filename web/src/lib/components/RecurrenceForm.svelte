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
		formPreview,
		type RecurrenceFormField,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import { WEEKDAY_NAMES, WEEKDAY_SHORT } from '$lib/domain/recurrence-text';
	import ErrorIcon from './ErrorIcon.svelte';

	// Fields of a rhythm (E5 plan, package 4), shared by "Wiederholen…", the rule panel and the
	// conversion of a calendar series: kind as a radio group, interval and unit, weekdays as a
	// labelled group of check boxes, day of the month with "Letzter Tag", start and lead time, and
	// the preview "Nächste Termine", which follows every change at once. Field errors stand at their
	// field (aria-invalid, aria-describedby); no state is shown by color alone.
	let {
		values = $bindable(),
		errors = {},
		today,
		withoutDue = false
	}: {
		values: RecurrenceFormValues;
		errors?: Partial<Record<RecurrenceFormField, string>>;
		today: CalendarDate;
		/** The ticket has no due date yet: name the first date it gets (ADR-0023 section 1). */
		withoutDue?: boolean;
	} = $props();

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
	const preview = $derived(formPreview(values, today, withoutDue));
	const previewText = $derived(preview.dates.map(formatCalendarDate).join(', '));
	/** Days 29 to 31 do not exist in every month: they are clamped (ADR-0021 section 2). */
	const clamped = $derived(!values.lastDay && Number(values.monthDay) >= 29);

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
</script>

{#snippet fieldError(field: RecurrenceFormField)}
	{#if errors[field]}
		<p class="field-error" id={errorIdOf(field)}><ErrorIcon /><span>{errors[field]}</span></p>
	{/if}
{/snippet}

<div class="recurrence-form">
	<fieldset class="group" aria-describedby={describedBy('mode')}>
		<legend>Art der Wiederholung</legend>
		<label class="choice">
			<input type="radio" name={idOf('mode')} value="calendar" bind:group={values.mode} />
			Fester Rhythmus
		</label>
		<label class="choice">
			<input type="radio" name={idOf('mode')} value="after_completion" bind:group={values.mode} />
			Nach Erledigung
		</label>
		{@render fieldError('mode')}
	</fieldset>

	<div class="field">
		<label for={idOf('interval')}>{calendar ? 'Alle' : 'Abstand nach Erledigung'}</label>
		<div class="inline">
			<input
				id={idOf('interval')}
				class="number"
				type="number"
				inputmode="numeric"
				min={INTERVAL_MIN}
				max={INTERVAL_MAX}
				step="1"
				bind:value={() => values.interval, (value) => (values.interval = String(value ?? ''))}
				aria-invalid={errors.interval ? 'true' : undefined}
				aria-describedby={describedBy('interval')}
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
		{@render fieldError('interval')}
		{@render fieldError('freq')}
	</div>

	{#if calendar && values.freq === 'weekly'}
		<fieldset class="group weekdays" aria-describedby={describedBy('weekdays')}>
			<legend>Wochentage</legend>
			<div class="days">
				{#each WEEKDAYS as day (day)}
					<label class="day">
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
		<div class="field">
			<label for={idOf('monthDay')}>Tag im Monat</label>
			<div class="inline">
				<input
					id={idOf('monthDay')}
					class="number"
					type="number"
					inputmode="numeric"
					min="1"
					max="31"
					step="1"
					disabled={values.lastDay}
					bind:value={() => values.monthDay, (value) => (values.monthDay = String(value ?? ''))}
					aria-invalid={errors.monthDay ? 'true' : undefined}
					aria-describedby={describedBy('monthDay', clamped ? idOf('monthDay-hint') : undefined)}
				/>
				<label class="choice">
					<input type="checkbox" bind:checked={values.lastDay} />
					Letzter Tag
				</label>
			</div>
			{#if clamped}
				<p class="hint" id={idOf('monthDay-hint')}>In kürzeren Monaten am letzten Tag.</p>
			{/if}
			{@render fieldError('monthDay')}
		</div>
	{/if}

	<div class="field">
		<label for={idOf('anchor')}>Beginnt am</label>
		<input
			id={idOf('anchor')}
			type="date"
			bind:value={values.anchor}
			aria-invalid={errors.anchor ? 'true' : undefined}
			aria-describedby={describedBy('anchor')}
		/>
		{@render fieldError('anchor')}
	</div>

	<div class="field">
		<label for={idOf('leadDays')}>Vorlauf (Tage)</label>
		<input
			id={idOf('leadDays')}
			class="number"
			type="number"
			inputmode="numeric"
			min={LEAD_DAYS_MIN}
			max={LEAD_DAYS_MAX}
			step="1"
			bind:value={() => values.leadDays, (value) => (values.leadDays = String(value ?? ''))}
			aria-invalid={errors.leadDays ? 'true' : undefined}
			aria-describedby={describedBy('leadDays', idOf('leadDays-hint'))}
		/>
		<p class="hint" id={idOf('leadDays-hint')}>
			So viele Tage vor der Fälligkeit erscheint das nächste Ticket (0 = am Tag selbst).
		</p>
		{@render fieldError('leadDays')}
	</div>

	<p class="preview" aria-live="polite">
		{#if preview.dates.length === 0}
			Nächste Termine erscheinen, sobald alle Angaben stimmen.
		{:else if calendar}
			Nächste Termine: {previewText}
		{:else}
			Wird das Ticket heute erledigt, ist das nächste am {previewText} fällig.
		{/if}
	</p>
	{#if preview.firstDue !== null}
		<p class="note">
			Das Ticket hat noch keine Fälligkeit und bekommt den ersten Termin: {formatCalendarDate(
				preview.firstDue
			)}.
		</p>
	{/if}
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

	legend,
	.field > label {
		margin-bottom: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.field {
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
		font-size: 0.875rem;
	}

	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.day {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	input:not([type='radio'], [type='checkbox']),
	select {
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	input[type='date'] {
		width: fit-content;
	}

	.number {
		width: 5rem;
	}

	/* Disabled fields; checkboxes and radios keep the look of base.css. */
	input:not([type='radio'], [type='checkbox']):disabled {
		color: var(--color-text-muted);
		background: var(--color-bg);
	}

	.hint,
	.note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.preview {
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}
</style>
