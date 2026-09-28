<script lang="ts">
	import { isCalendarDate } from '$lib/domain/berlin-date';
	import {
		MAX_SHIFT,
		ticketCount,
		validShift,
		type DueAction,
		type ShiftUnit
	} from '$lib/domain/bulk';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Fälligkeit …" of the bulk actions (plan BI-2, ADR-0036 §3 and §5): set a date, shift by days
	// or weeks (a negative number moves earlier), clear, or take the date of the event the ticket was
	// converted from. Modal S with one choice as radios; a wrong date or number stays at its field.
	let {
		count,
		onapply,
		onclose
	}: {
		/** Number of chosen tickets. */
		count: number;
		onapply: (action: DueAction) => void;
		onclose: () => void;
	} = $props();

	type Mode = DueAction['mode'];

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		legend: `${uid}-legend`,
		date: `${uid}-date`,
		dateError: `${uid}-date-error`,
		amount: `${uid}-amount`,
		unit: `${uid}-unit`,
		amountError: `${uid}-amount-error`,
		sourceHint: `${uid}-source-hint`
	};

	const MODES: readonly { value: Mode; label: string }[] = [
		{ value: 'set', label: 'Datum setzen' },
		{ value: 'shift', label: 'Verschieben um' },
		{ value: 'clear', label: 'Fälligkeit leeren' },
		{ value: 'source', label: 'Datum der Quelle übernehmen' }
	];

	let mode = $state<Mode>('set');
	let date = $state('');
	let amount = $state('1');
	let unit = $state<ShiftUnit>('days');
	let dateError = $state<string | null>(null);
	let amountError = $state<string | null>(null);

	const title = $derived(`Fälligkeit für ${ticketCount(count)}`);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		dateError = null;
		amountError = null;
		if (mode === 'set') {
			if (!isCalendarDate(date)) {
				dateError = 'Bitte ein gültiges Datum wählen.';
				return;
			}
			onapply({ kind: 'due', mode: 'set', date });
			return;
		}
		if (mode === 'shift') {
			const value = Number(amount);
			if (!validShift(value)) {
				amountError = `Eine ganze Zahl ungleich 0, höchstens ${MAX_SHIFT} in jede Richtung.`;
				return;
			}
			onapply({ kind: 'due', mode: 'shift', amount: value, unit });
			return;
		}
		onapply(mode === 'clear' ? { kind: 'due', mode: 'clear' } : { kind: 'due', mode: 'source' });
	}
</script>

<Modal open size="s" {title} onclose={() => onclose()}>
	<form id={ids.form} class="form" onsubmit={submit} novalidate>
		<fieldset>
			<legend id={ids.legend} class="visually-hidden">Neue Fälligkeit</legend>
			{#each MODES as choice (choice.value)}
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-mode`}
						value={choice.value}
						checked={mode === choice.value}
						aria-describedby={choice.value === 'source' ? ids.sourceHint : undefined}
						onchange={() => (mode = choice.value)}
					/>
					<span>{choice.label}</span>
				</label>
				{#if choice.value === 'set' && mode === 'set'}
					<div class="detail">
						<label class="visually-hidden" for={ids.date}>Datum</label>
						<input
							id={ids.date}
							type="date"
							bind:value={date}
							aria-invalid={dateError ? 'true' : undefined}
							aria-describedby={dateError ? ids.dateError : undefined}
						/>
						{#if dateError}
							<p class="field-error" id={ids.dateError}><ErrorIcon /><span>{dateError}</span></p>
						{/if}
					</div>
				{:else if choice.value === 'shift' && mode === 'shift'}
					<div class="detail">
						<div class="inline">
							<label class="visually-hidden" for={ids.amount}>Anzahl</label>
							<input
								id={ids.amount}
								class="amount"
								type="number"
								step="1"
								min={-MAX_SHIFT}
								max={MAX_SHIFT}
								bind:value={amount}
								aria-invalid={amountError ? 'true' : undefined}
								aria-describedby={amountError ? ids.amountError : undefined}
							/>
							<label class="visually-hidden" for={ids.unit}>Einheit</label>
							<select id={ids.unit} bind:value={unit}>
								<option value="days">Tage</option>
								<option value="weeks">Wochen</option>
							</select>
						</div>
						<p class="hint">
							Eine negative Zahl verschiebt nach vorn. Tickets ohne Fälligkeit bleiben, wie sie
							sind.
						</p>
						{#if amountError}
							<p class="field-error" id={ids.amountError}>
								<ErrorIcon /><span>{amountError}</span>
							</p>
						{/if}
					</div>
				{:else if choice.value === 'source'}
					<p class="hint detail" id={ids.sourceHint}>
						Nur für Tickets aus einem Kalendertermin (.ics oder Google Calendar): das Datum des
						Termins. Die übrigen werden übersprungen und im Ergebnis genannt.
					</p>
				{/if}
			{/each}
		</fieldset>
	</form>
	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		<button class="button-primary" type="submit" form={ids.form}>Übernehmen</button>
	{/snippet}
</Modal>

<style>
	.form,
	fieldset {
		display: grid;
		gap: 0.5rem;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.choice {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	.detail {
		display: grid;
		gap: 0.375rem;
		margin-left: 1.5rem;
	}

	.inline {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.amount {
		width: 6rem;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
