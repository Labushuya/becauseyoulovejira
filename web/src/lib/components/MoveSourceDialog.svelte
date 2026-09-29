<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { alreadyLinkedReason, blockTicket, sameScope } from '$lib/domain/ticket-picker';
	import type { TicketSummary } from '$lib/domain/ticket';
	import {
		findTicketPickerSource,
		type TicketPickerSource
	} from '$lib/stores/ticket-picker.svelte';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import TicketPicker from './TicketPicker.svelte';

	// "Anderem Ticket zuordnen …" (ADR-0031, addendum): a linked entry changes directly from its
	// ticket to another one, in one step and atomic in the hook, which writes the history of both
	// tickets. Modal M with the ticket picker (ADR-0042): the list opens with the dialog; the current
	// ticket stays visible but cannot be chosen, tickets of another area neither. The main source
	// never gets here (the callers show why instead). A refusal stays in the dialog.
	let {
		item,
		current,
		store,
		picker,
		onclose,
		onmoved = () => undefined
	}: {
		item: Pick<InboxItemSummary, 'id' | 'title' | 'scope'>;
		/** The ticket the entry belongs to now. */
		current: { id: string; key: string };
		store: TicketSourcesStore;
		/** Tickets of the picker; the (app) layout provides them. */
		picker?: TicketPickerSource;
		onclose: () => void;
		/** The entry after the move. */
		onmoved?: (item: InboxItemSummary) => void;
	} = $props();

	const fromContext = findTicketPickerSource();
	const source = $derived(picker ?? fromContext);
	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;
	const rules = $derived([
		blockTicket(current.id, alreadyLinkedReason(current.key)),
		sameScope(item.scope)
	]);

	let ticket = $state<TicketSummary | null>(null);
	let fieldError = $state<string | null>(null);
	let failure = $state<string | null>(null);
	let busy = $state(false);

	async function move(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (ticket === null) {
			fieldError = 'Bitte ein Ticket wählen.';
			return;
		}
		fieldError = null;
		failure = null;
		busy = true;
		try {
			const result = await store.move(item, ticket);
			if (result.ok) {
				onmoved(result.value);
				onclose();
			} else if (result.message !== null) {
				failure = result.message;
			}
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	open
	size="m"
	title="Anderem Ticket zuordnen"
	describedBy={describedId}
	{busy}
	onclose={() => onclose()}
>
	<form id={formId} class="form" novalidate onsubmit={move}>
		<p id={describedId}>
			„{item.title}“ gehört zu {current.key} und wechselt direkt zum gewählten Ticket. Beide Tickets vermerken
			den Wechsel im Verlauf.
		</p>
		{#if source}
			<TicketPicker
				label="Neues Ticket"
				hint="Aus der Liste wählen oder tippen; erledigte Tickets ohne „Nur offene“."
				{source}
				{rules}
				bind:value={ticket}
				error={fieldError}
			/>
		{/if}
		{#if failure !== null}
			<p class="alert-error" role="alert"><ErrorIcon /><span>{failure}</span></p>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
			Abbrechen
		</button>
		<button class="button-primary" type="submit" form={formId} aria-disabled={busy}>
			{busy ? 'Wird zugeordnet …' : 'Zuordnen'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
		font-size: var(--font-size-body);
	}
</style>
