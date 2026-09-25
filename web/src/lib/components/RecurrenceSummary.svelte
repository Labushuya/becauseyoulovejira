<script lang="ts">
	import { tick } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		defaultFormValues,
		formPreview,
		formValuesOf,
		nextTicketText,
		ruleText,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import type { Ticket } from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import { RECURRENCE_UNAVAILABLE, type RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import RecurrenceDialog from './RecurrenceDialog.svelte';

	// Recurrence of the ticket in the panel (E5 plan, package 4). A ticket in a series shows
	// "Wiederholt sich: jeden Montag · Nächstes Ticket am 28.09." with "Regel bearbeiten",
	// "Pausieren" or "Fortsetzen" and "Aus der Serie lösen"; an open ticket without a series offers
	// "Wiederholen…". Actions work at once and are announced (aria-live); a paused rule shows its
	// hint neutrally, a refused request as an error (ADR-0009).
	let {
		ticket,
		store,
		today,
		onticket
	}: {
		ticket: Ticket;
		store: RecurrenceStore;
		today: CalendarDate;
		/** The ticket after joining or leaving its series, for panel and list. */
		onticket: (ticket: Ticket) => void;
	} = $props();

	const uid = $props.id();
	const rule = $derived(store.ruleById(ticket.recurrenceId));
	const text = $derived(rule === null ? '' : ruleText(rule));

	let dialog = $state<'create' | 'edit' | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let repeatButton = $state<HTMLButtonElement>();
	let editButton = $state<HTMLButtonElement>();

	async function closeDialog() {
		const opener = dialog;
		dialog = null;
		await tick();
		if (opener === 'create' && repeatButton?.isConnected) repeatButton.focus();
		else editButton?.focus();
	}

	async function repeat(values: RecurrenceFormValues) {
		const result = await store.repeat(ticket, values);
		if (result.ok) {
			const firstDue =
				ticket.due === null && values.mode === 'calendar'
					? formPreview(values, today, true).firstDue
					: null;
			onticket({
				...ticket,
				recurring: true,
				recurrenceId: result.value.id,
				due: ticket.due ?? firstDue
			});
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
			{/if}
		</p>
		{#if rule !== null && rule.lastHint !== ''}
			<p class="hint">{rule.lastHint}</p>
		{/if}
		<div class="actions">
			{#if rule !== null}
				{@const current = rule}
				<button
					class="small"
					type="button"
					aria-haspopup="dialog"
					bind:this={editButton}
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
		<p class="hint">{RECURRENCE_UNAVAILABLE}</p>
	{:else if ticket.status !== 'done'}
		<button
			class="small"
			type="button"
			aria-haspopup="dialog"
			bind:this={repeatButton}
			onclick={() => (dialog = 'create')}
		>
			Wiederholen…
		</button>
	{/if}
	{#if error}
		<div class="alert-error" role="alert"><ErrorIcon /><span>{error}</span></div>
	{/if}
	<p class="visually-hidden" aria-live="polite">{store.announcement}</p>
</section>

{#if dialog === 'create'}
	<RecurrenceDialog
		heading="Wiederholen…"
		initial={defaultFormValues(ticket.due, today)}
		{today}
		withoutDue={ticket.due === null}
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

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
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
		border-radius: 0.375rem;
		cursor: pointer;
	}

	[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
