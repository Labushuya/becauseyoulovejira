<script lang="ts">
	import { untrack } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		defaultFormValues,
		formValuesOf,
		isWaiting,
		joinedSeries,
		nextTicketText,
		openBlockText,
		parseSkipped,
		ruleText,
		skippedText,
		SKIPPED_FIELD,
		type OpenInstance,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import type { HistoryEntry, Ticket } from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import { RECURRENCE_UNAVAILABLE, type RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import RecurrenceBacklogQuestion from './RecurrenceBacklogQuestion.svelte';
	import RecurrenceDialog from './RecurrenceDialog.svelte';

	// Recurrence of the ticket in the panel (E5 plan, package 4). A ticket in a series shows
	// "Wiederholt sich: jeden Montag · Nächstes Ticket am 28.09." with "Regel bearbeiten",
	// "Pausieren" or "Fortsetzen" and "Aus der Serie lösen"; an open ticket without a series offers
	// "Wiederholen…". Actions work at once and are announced as flags by the store; a paused rule
	// shows its hint neutrally, a refused request as an error (ADR-0009). "Wiederholen…" may come
	// prepared from a calendar series (E5 plan, package 6; store.offerRepeat): from the inbox panel it
	// opens at once, after a failed conversion the panel shows why and offers the prepared dialog.
	let {
		ticket,
		store,
		today,
		history = [],
		openTickets = [],
		onticket
	}: {
		ticket: Ticket;
		store: RecurrenceStore;
		today: CalendarDate;
		/** Open tickets of the series of the ticket, oldest first (recommendation 6). */
		openTickets?: readonly OpenInstance[];
		/**
		 * History of the ticket as the panel loaded it; a catch-up ticket finds its note about the
		 * missed dates there (ADR-0022 addendum 4).
		 */
		history?: readonly HistoryEntry[];
		/** The ticket after joining or leaving its series, for panel and list. */
		onticket: (ticket: Ticket) => void;
	} = $props();

	const uid = $props.id();
	const rule = $derived(store.ruleById(ticket.recurrenceId));
	const text = $derived(rule === null ? '' : ruleText(rule));
	const skipped = $derived.by(() => {
		const entry = history.find((item) => item.ticket === ticket.id && item.field === SKIPPED_FIELD);
		return entry === undefined ? null : parseSkipped(entry.newValue);
	});

	const initialOffer = untrack(() =>
		ticket.recurring || ticket.status === 'done' ? null : store.takeOffer(ticket.id)
	);
	/** Offer taken for this ticket; it prepares "Wiederholen…" until a rule exists. */
	let offer = $state(initialOffer);
	const prepared = $derived(offer !== null && offer.ticketId === ticket.id ? offer.values : null);

	let dialog = $state<'create' | 'edit' | null>(
		initialOffer !== null && initialOffer.message === null ? 'create' : null
	);
	let busy = $state(false);
	let error = $state<string | null>(initialOffer?.message ?? null);

	// The modal returns the focus to its opener, or to the heading of the view when the opener is
	// gone (after "Wiederholen…" the button gives way to the summary; ADR-0025 section 3).
	function closeDialog() {
		dialog = null;
	}

	async function repeat(values: RecurrenceFormValues) {
		const result = await store.repeat(ticket, values);
		if (result.ok) {
			offer = null;
			error = null;
			onticket(joinedSeries(ticket, result.value.id, values, today));
		}
		return result;
	}

	/** Runs one action of the summary; a refusal shows as an error with its reason. */
	async function act(action: () => Promise<EditResult<unknown>>) {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const result = await action();
			if (!result.ok) error = result.message ?? Object.values(result.fields)[0] ?? null;
		} finally {
			busy = false;
		}
	}

	async function detach() {
		await act(async () => {
			const result = await store.detach(ticket.id);
			if (result.ok) onticket(result.value);
			return result;
		});
	}
</script>

<section class="recurrence" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`} class="visually-hidden">Wiederholung</h3>
	{#if ticket.recurring}
		<p class="line">
			<span>Wiederholt sich{text === '' ? '' : `: ${text}`}</span>
			{#if rule !== null}
				<span aria-hidden="true">·</span>
				<span>{nextTicketText(rule, today)}</span>
				{#if rule.eachOccurrence === true}
					<span aria-hidden="true">·</span>
					<span>jeder Termin einzeln</span>
				{/if}
			{/if}
		</p>
		{#if skipped !== null}
			<SectionMessage tone="info" compact>
				{skippedText(skipped, today)}; dieses Ticket steht für sie mit.
			</SectionMessage>
		{/if}
		{#if rule !== null && !rule.eachOccurrence && rule.active && openTickets.length > 1}
			<!-- The switch went off while several were open (recommendation 6). -->
			<SectionMessage tone="info" compact>
				{openBlockText(openTickets.map((open) => open.key))}
			</SectionMessage>
		{/if}
		{#if rule !== null && isWaiting(rule)}
			{@const current = rule}
			<RecurrenceBacklogQuestion
				rule={current}
				{today}
				{busy}
				ondecide={(choice) => act(() => store.decideBacklog(current.id, choice, today))}
			/>
		{:else if rule !== null && rule.lastHint !== ''}
			<SectionMessage tone="info" compact>{rule.lastHint}</SectionMessage>
		{/if}
		<div class="actions">
			{#if rule !== null}
				{@const current = rule}
				<button
					class="small"
					type="button"
					aria-haspopup="dialog"
					onclick={() => (dialog = 'edit')}
				>
					Regel bearbeiten
				</button>
				<button
					class="small"
					type="button"
					aria-disabled={busy}
					onclick={() => act(() => store.setActive(current.id, !current.active))}
				>
					{current.active ? 'Pausieren' : 'Fortsetzen'}
				</button>
			{/if}
			<button class="small" type="button" aria-disabled={busy} onclick={detach}>
				Aus der Serie lösen
			</button>
		</div>
	{:else if store.state === 'unavailable'}
		<SectionMessage tone="info" compact>{RECURRENCE_UNAVAILABLE}</SectionMessage>
	{:else if ticket.status !== 'done'}
		<button class="small" type="button" aria-haspopup="dialog" onclick={() => (dialog = 'create')}>
			Wiederholen…
		</button>
	{/if}
	{#if error}
		<div class="alert-error" role="alert"><ErrorIcon /><span>{error}</span></div>
	{/if}
</section>

{#if dialog === 'create'}
	<RecurrenceDialog
		heading="Wiederholen…"
		initial={prepared ?? defaultFormValues(ticket.due, today)}
		{today}
		withoutDue={ticket.due === null}
		eachAvailable={store.eachReady}
		context={{ kind: 'ticket', due: ticket.due }}
		submitLabel="Wiederholung anlegen"
		onsave={repeat}
		onclose={closeDialog}
	/>
{:else if dialog === 'edit' && rule !== null}
	{@const current = rule}
	<RecurrenceDialog
		heading="Regel bearbeiten"
		initial={formValuesOf(current, today)}
		{today}
		eachAvailable={store.eachReady}
		context={{ kind: 'rule', nextDue: current.nextDue, each: current.eachOccurrence === true }}
		openKeys={openTickets.map((open) => open.key)}
		submitLabel="Speichern"
		onsave={(values) => store.saveRhythm(current.id, values)}
		onclose={closeDialog}
	/>
{/if}

<style>
	.recurrence {
		display: grid;
		gap: 0.375rem;
		font-size: 0.875rem;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.small {
		width: fit-content;
		padding: 0.125rem 0.625rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
