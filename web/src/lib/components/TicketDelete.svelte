<script lang="ts">
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// "Löschen …" of a ticket (E2 plan, package 11), shared by the side panel and the full view:
	// the confirmation asks before deleting for good and returns the focus itself. A failure stays in
	// the dialog; after deleting, the owner closes the view.
	let { store, ondeleted }: { store: TicketDetailStore; ondeleted: () => void } = $props();

	let confirming = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);

	const ticket = $derived(store.ticket);

	function ask() {
		error = null;
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
		const result = await store.deleteTicket();
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
	</ConfirmDialog>
{/if}
