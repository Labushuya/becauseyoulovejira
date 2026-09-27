<script lang="ts">
	import {
		SOURCE_HANDLINGS,
		SOURCE_HANDLING_HINTS,
		SOURCE_HANDLING_LABELS,
		sourceCountText,
		type SourceHandling
	} from '$lib/domain/sources';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// "Löschen …" of a ticket (E2 plan, package 11), shared by the side panel and the full view:
	// the confirmation asks before deleting for good and returns the focus itself. A failure stays in
	// the dialog; after deleting, the owner closes the view. A ticket with sources (ADR-0031,
	// addendum B) names their number and asks what happens to them: back to the inbox (chosen at
	// first) or discarded. They are never deleted with the ticket.
	let {
		store,
		ondeleted,
		sourceCount = 0
	}: {
		store: TicketDetailStore;
		ondeleted: () => void;
		/** Number of sources of the ticket (inbox items with `ticket = <id>`). */
		sourceCount?: number;
	} = $props();

	const uid = $props.id();

	let confirming = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	let handling = $state<SourceHandling>('inbox');

	const ticket = $derived(store.ticket);

	function ask() {
		error = null;
		handling = 'inbox';
		confirming = true;
	}

	function cancel() {
		confirming = false;
		error = null;
	}

	async function remove() {
		if (deleting) return;
		deleting = true;
		error = null;
		const result = await store.deleteTicket(
			sourceCount > 0 ? { count: sourceCount, handling } : undefined
		);
		deleting = false;
		if (result.ok) {
			confirming = false;
			ondeleted();
		} else if (result.message !== null) {
			error = result.message;
		} else {
			confirming = false;
		}
	}
</script>

<button class="button-subtle" type="button" aria-haspopup="dialog" onclick={ask}>Löschen …</button>

{#if ticket}
	<ConfirmDialog
		open={confirming}
		title={`${ticket.key} endgültig löschen?`}
		confirmLabel="Endgültig löschen"
		busy={deleting}
		{error}
		onconfirm={remove}
		oncancel={cancel}
	>
		<p>
			Dabei werden auch alle Kommentare und der gesamte Verlauf dieses Tickets gelöscht. Das lässt
			sich nicht rückgängig machen.
			{#if ticket.recurring && ticket.status !== 'done'}Die Regel läuft weiter.{/if}
		</p>
		{#if sourceCount > 0}
			<p>{sourceCountText(sourceCount)} Sie werden nicht mitgelöscht.</p>
		{/if}
		{#snippet options()}
			{#if sourceCount > 0}
				<fieldset class="handling">
					<legend>Quellen</legend>
					{#each SOURCE_HANDLINGS as value (value)}
						<label class="choice">
							<input
								type="radio"
								name={`${uid}-sources`}
								{value}
								checked={handling === value}
								disabled={deleting}
								aria-describedby={`${uid}-${value}-hint`}
								onchange={() => (handling = value)}
							/>
							<span class="choice-text">
								<span>{SOURCE_HANDLING_LABELS[value]}</span>
								<span class="hint" id={`${uid}-${value}-hint`}>{SOURCE_HANDLING_HINTS[value]}</span>
							</span>
						</label>
					{/each}
				</fieldset>
			{/if}
		{/snippet}
	</ConfirmDialog>
{/if}

<style>
	.handling {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.choice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
		cursor: pointer;
	}

	.choice input {
		margin-top: 0.125rem;
	}

	.choice-text {
		display: grid;
		gap: 0.125rem;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
