<script lang="ts">
	import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import {
		findTicketFollowUpStore,
		type TicketFollowUpStore
	} from '$lib/stores/ticket-follow-up.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import DuplicateDialog from './DuplicateDialog.svelte';
	import FollowUpDialog from './FollowUpDialog.svelte';
	import TicketDelete from './TicketDelete.svelte';

	// The questions of the menu "•••" of a ticket row (plan aktionsmenues, AM-2): "Duplizieren …",
	// "Folge-Ticket anlegen …" (ADR-0067) and "In den Papierkorb …", once the store loaded what they
	// need. Shown by the owner of the
	// rows: the table "Aufgaben" and, for the open tickets of the projects (ADR-0034, addendum
	// "Offene Tickets in Projekten"), the project view. Neither is a modal, so the questions open as
	// the dialogs of the panel, and the modal gives the focus back to "•••" (or the heading).
	let {
		rowActions,
		duplicates = null,
		followUps = findTicketFollowUpStore(),
		projects,
		subtaskCountOf,
		parentKeyOf,
		onopen,
		moveToTrash = null
	}: {
		rowActions: TicketRowActionsStore;
		/** "Duplizieren …" (ADR-0045); null: the menu has no such entry. */
		duplicates?: TicketDuplicateStore | null;
		/** "Folge-Ticket anlegen …" (ADR-0067); null: the menu has no such entry. */
		followUps?: TicketFollowUpStore | null;
		/** Projects a duplicate can join (the active ones, in tree order). */
		projects: readonly ProjectRef[];
		/** Number of sub-tasks of a ticket. */
		subtaskCountOf: (ticketId: string) => number;
		/** Key of the parent of a sub-task, null for a top-level ticket. */
		parentKeyOf: (ticket: TicketSummary) => string | null;
		/** Opens a ticket in the remembered way (the duplicate, or the original from the flag). */
		onopen: (ticketId: string) => void;
		/** Moves the ticket of the question to the trash; null: through the store alone. */
		moveToTrash?: ((ticketId: string, sources?: DeleteSources) => Promise<DeleteResult>) | null;
	} = $props();

	const dialog = $derived(rowActions.dialog);

	function remove(ticketId: string, sources?: DeleteSources): Promise<DeleteResult> {
		return moveToTrash === null ? rowActions.deleteTicket(sources) : moveToTrash(ticketId, sources);
	}
</script>

{#if dialog?.kind === 'duplicate' && duplicates !== null}
	<DuplicateDialog
		ticket={dialog.ticket}
		{projects}
		sources={dialog.sources}
		ticketSources={dialog.ticketSources ?? []}
		commentCount={dialog.commentCount}
		subtaskCount={subtaskCountOf(dialog.ticket.id)}
		parentKey={parentKeyOf(dialog.ticket)}
		store={duplicates}
		{onopen}
		onclose={() => rowActions.close()}
	/>
{:else if dialog?.kind === 'followup' && followUps !== null}
	{@const ticket = dialog.ticket}
	<FollowUpDialog
		{ticket}
		project={projects.find((project) => project.id === ticket.projectId) ?? ticket.project}
		store={followUps}
		{onopen}
		onclose={() => rowActions.close()}
	/>
{:else if dialog?.kind === 'delete'}
	{@const ticket = dialog.ticket}
	<TicketDelete
		{ticket}
		remove={(sources) => remove(ticket.id, sources)}
		onclose={() => rowActions.close()}
		sourceCount={dialog.sourceCount}
		subtaskCount={subtaskCountOf(ticket.id)}
	/>
{/if}
