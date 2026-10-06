<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import InboxEntryChoice from './InboxEntryChoice.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Quelle hinzufügen …" in the ticket (ADR-0031 section 7): choose new entries of the inbox and
	// link them to this ticket, the same way as "Mit Ticket verknüpfen …" in the inbox. Modal M with
	// the search and the checkboxes of InboxEntryChoice, the same choice as in "Neues Ticket" (NT-1).
	// Without failures the dialog closes (the flag names the result); failed entries stay chosen with
	// their reason. Inside a modal (the full view) the same form unfolds inline where the owner renders
	// it (ADR-0025 section 3, addendum 16).
	let {
		ticket,
		candidates,
		store,
		onclose
	}: {
		ticket: { id: string; key: string };
		/** The new entries of the inbox. */
		candidates: readonly InboxItemSummary[];
		store: TicketSourcesStore;
		onclose: () => void;
	} = $props();

	const inline = insideModal();
	const uid = $props.id();
	const formId = `${uid}-form`;

	let chosen = $state<string[]>([]);
	let failures = $state<{ id: string; title: string; message: string }[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function link(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const items = candidates.filter((item) => chosen.includes(item.id));
		if (items.length === 0) {
			error = 'Bitte mindestens einen Eintrag wählen.';
			return;
		}
		busy = true;
		try {
			const outcome = await store.link(items, ticket);
			failures = outcome.failures;
			const failed = outcome.failures.map((failure) => failure.id);
			chosen = chosen.filter((id) => failed.includes(id));
			if (outcome.failures.length === 0) onclose();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet content()}
	{#if candidates.length === 0}
		<EmptyState
			size="compact"
			title="Keine neuen Einträge"
			description="Im Eingang wartet gerade nichts, das eine Quelle werden könnte."
		/>
	{:else}
		<form id={formId} class="form" novalidate onsubmit={link}>
			<p>Gewählte Einträge werden Quellen von {ticket.key}.</p>
			<InboxEntryChoice {candidates} bind:chosen {error} onchange={() => (error = null)} />
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
	{/if}
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		{failures.length > 0 ? 'Schließen' : 'Abbrechen'}
	</button>
	{#if candidates.length > 0}
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={busy}
			aria-busy={busy ? 'true' : undefined}
		>
			{busy ? 'Wird verknüpft …' : `Verknüpfen${chosen.length > 0 ? ` (${chosen.length})` : ''}`}
		</button>
	{/if}
{/snippet}

{#if inline}
	<InlineDialog open title="Quelle hinzufügen" {busy} onclose={() => onclose()} footer={buttons}>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal open size="m" title="Quelle hinzufügen" {busy} onclose={() => onclose()} footer={buttons}>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.75rem;
		font-size: var(--font-size-body);
	}

	.alert-error ul {
		padding-left: 1rem;
	}
</style>
