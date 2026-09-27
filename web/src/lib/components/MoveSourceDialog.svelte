<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import type { TicketChoice, TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import TicketCombobox from './TicketCombobox.svelte';

	// "Anderem Ticket zuordnen …" (ADR-0031, addendum): a linked entry changes directly from its
	// ticket to another one, in one step and atomic in the hook, which writes the history of both
	// tickets. Modal M with the ticket search as combobox; the current ticket is not offered. The
	// main source never gets here (the callers show why instead). A refusal stays in the dialog.
	let {
		item,
		current,
		store,
		onclose,
		onmoved = () => undefined
	}: {
		item: Pick<InboxItemSummary, 'id' | 'title'>;
		/** The ticket the entry belongs to now. */
		current: { id: string; key: string };
		store: TicketSourcesStore;
		onclose: () => void;
		/** The entry after the move. */
		onmoved?: (item: InboxItemSummary) => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;

	let ticket = $state<TicketChoice | null>(null);
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
		if (ticket.id === current.id) {
			fieldError = `Der Eintrag gehört schon zu ${current.key}.`;
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
		<TicketCombobox
			label="Neues Ticket"
			hint="Nummer, Key oder Titel eingeben, auch erledigte Tickets."
			search={async (text, options) =>
				(await store.search(text, options)).filter((choice) => choice.id !== current.id)}
			bind:value={ticket}
			error={fieldError}
		/>
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
