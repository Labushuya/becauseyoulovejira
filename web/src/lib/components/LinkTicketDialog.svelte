<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import type { TicketChoice, TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import TicketCombobox from './TicketCombobox.svelte';

	// "Mit Ticket verknüpfen …" (ADR-0031 sections 2 and 7): links one or several new inbox entries
	// to any ticket, also one typed in by hand. Modal M with the ticket search as combobox; the
	// entries are linked one after the other through the same way as "Dem Ticket zuordnen". Without
	// failures the dialog closes (the flag names the result); failed entries stay with their reason
	// and can be tried again.
	let {
		items,
		store,
		onclose,
		onlinked = () => undefined
	}: {
		items: readonly Pick<InboxItemSummary, 'id' | 'title'>[];
		store: TicketSourcesStore;
		onclose: () => void;
		/** IDs of the entries that were linked (e.g. to clear the selection of the table). */
		onlinked?: (ids: string[]) => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;

	/** The entries of the dialog as it opened. */
	function initialItems() {
		return items.map(({ id, title }) => ({ id, title }));
	}

	// After a partial failure only the failed entries remain.
	let remaining = $state(initialItems());
	let ticket = $state<TicketChoice | null>(null);
	let error = $state<string | null>(null);
	let failures = $state<{ id: string; title: string; message: string }[]>([]);
	let busy = $state(false);

	const heading = $derived(
		items.length === 1 ? 'Mit Ticket verknüpfen' : `${items.length} Einträge mit Ticket verknüpfen`
	);

	async function link(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (ticket === null) {
			error = 'Bitte ein Ticket wählen.';
			return;
		}
		error = null;
		busy = true;
		try {
			const outcome = await store.link(remaining, ticket);
			const linked = outcome.linked.map((item) => item.id);
			if (linked.length > 0) onlinked(linked);
			failures = outcome.failures;
			remaining = remaining.filter((item) => !linked.includes(item.id));
			if (outcome.failures.length === 0 && remaining.length === 0) onclose();
		} finally {
			busy = false;
		}
	}
</script>

<Modal open size="m" title={heading} describedBy={describedId} {busy} onclose={() => onclose()}>
	<form id={formId} class="form" novalidate onsubmit={link}>
		<div id={describedId}>
			{#if remaining.length === 1}
				<p>„{remaining[0]?.title}“ wird eine Quelle des gewählten Tickets.</p>
			{:else}
				<p>Diese Einträge werden Quellen des gewählten Tickets:</p>
				<ul class="items">
					{#each remaining as item (item.id)}
						<li>{item.title}</li>
					{/each}
				</ul>
			{/if}
		</div>
		<TicketCombobox
			label="Ticket"
			hint="Nummer, Key oder Titel eingeben, auch erledigte Tickets."
			search={(text, options) => store.search(text, options)}
			bind:value={ticket}
			{error}
		/>
		{#if failures.length > 0}
			<div class="alert-error" role="alert">
				<ErrorIcon />
				<div>
					<p>Nicht verknüpft:</p>
					<ul>
						{#each failures as failure (failure.id)}
							<li>„{failure.title}“: {failure.message}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
			{failures.length > 0 ? 'Schließen' : 'Abbrechen'}
		</button>
		<button class="button-primary" type="submit" form={formId} aria-disabled={busy}>
			{busy ? 'Wird verknüpft …' : 'Verknüpfen'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
		font-size: var(--font-size-body);
	}

	.items {
		display: grid;
		gap: 0.125rem;
		margin-top: 0.25rem;
		padding-left: 1.25rem;
	}

	.alert-error ul {
		padding-left: 1rem;
	}
</style>
