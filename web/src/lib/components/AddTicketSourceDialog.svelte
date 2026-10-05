<script lang="ts">
	import { sourcePickerRules } from '$lib/domain/ticket-origins';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { insideModal } from '$lib/overlay/modal-context';
	import {
		findTicketPickerSource,
		type TicketPickerSource
	} from '$lib/stores/ticket-picker.svelte';
	import type { TicketOriginsStore } from '$lib/stores/ticket-origins.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';
	import TicketPicker from './TicketPicker.svelte';

	// "Quelle hinzufügen → Ticket" (QT-1, ADR-0067 §4): the open ticket stems from the chosen one from
	// now on. Modal M with the ticket picker (ADR-0042); its list opens with the dialog and shows done
	// tickets as well ("Nur offene" off), because a source is often done. Not offered: the ticket
	// itself, its sources and every ticket that stems from it (the origins of the store, a circle);
	// tickets of another area stay visible with the reason. The server checks again: a circle it finds
	// (another tab linked meanwhile) stands at the field with its chain. Inside a modal (the full view)
	// the same form unfolds inline (ADR-0025 section 3, addendum 16).
	let {
		ticket,
		store,
		picker,
		returnFocus,
		onclose
	}: {
		ticket: Pick<TicketSummary, 'id' | 'key' | 'scope'>;
		store: TicketOriginsStore;
		/** Tickets of the picker; the (app) layout provides them. */
		picker?: TicketPickerSource;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
		onclose: () => void;
	} = $props();

	const fromContext = findTicketPickerSource();
	const source = $derived(picker ?? fromContext);
	const inline = insideModal();
	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;
	const rules = $derived(
		sourcePickerRules(ticket, store.ticketId === ticket.id ? store.origins : null)
	);
	const title = $derived(`Quelle für ${ticket.key} hinzufügen`);

	let chosen = $state<TicketSummary | null>(null);
	let fieldError = $state<string | null>(null);
	let busy = $state(false);

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (chosen === null) {
			fieldError = 'Bitte ein Ticket wählen.';
			return;
		}
		fieldError = null;
		busy = true;
		try {
			const result = await store.add(
				{ id: ticket.id, key: ticket.key },
				{ id: chosen.id, key: chosen.key }
			);
			if (result.ok) onclose();
			else if (result.message !== null) fieldError = result.message;
		} finally {
			busy = false;
		}
	}
</script>

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={add}>
		<p id={describedId}>
			{ticket.key} stammt dann aus dem gewählten Ticket. Beide Tickets zeigen die Verknüpfung und vermerken
			sie im Verlauf.
		</p>
		{#if source}
			<TicketPicker
				label="Ticket als Quelle"
				hint="Aus der Liste wählen oder tippen; offene und erledigte Tickets. Tickets, die aus diesem stammen, fehlen, weil sie einen Kreis schließen würden."
				{source}
				{rules}
				openOnly={false}
				bind:value={chosen}
				error={fieldError}
				onchoose={() => (fieldError = null)}
			/>
		{/if}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		Abbrechen
	</button>
	<button
		class="button-primary"
		type="submit"
		form={formId}
		aria-disabled={busy}
		aria-busy={busy ? 'true' : undefined}
	>
		{busy ? 'Wird hinzugefügt …' : 'Als Quelle hinzufügen'}
	</button>
{/snippet}

{#if inline}
	<InlineDialog
		open
		{title}
		describedBy={describedId}
		{busy}
		{returnFocus}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal
		open
		size="m"
		{title}
		describedBy={describedId}
		{busy}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.875rem;
		font-size: var(--font-size-body);
	}
</style>
