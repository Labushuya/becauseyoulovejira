<script lang="ts">
	import { sourceCountText } from '$lib/domain/sources';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { retentionText, subtasksAlongText } from '$lib/domain/trash';
	import { findTrashStore } from '$lib/stores/trash.svelte';

	// What deleting a ticket does (E2 plan, package 11; ADR-0031, addendum B; ADR-0033 section 4;
	// ADR-0037): it goes with comments, history and sub-tasks into the trash and can be restored
	// there until the retention runs out; the rule of a series runs on. Shared by the confirmation
	// of the side panel and the inline question of the full view.
	let {
		ticket,
		sourceCount = 0,
		subtaskCount = 0
	}: {
		ticket: Pick<TicketSummary, 'recurring' | 'status'>;
		sourceCount?: number;
		subtaskCount?: number;
	} = $props();

	const trash = findTrashStore();
</script>

<p>
	Das Ticket kommt mit Kommentaren und Verlauf in den Papierkorb und lässt sich dort
	wiederherstellen.
	{#if trash}{retentionText(trash.retention)}{/if}
	{#if ticket.recurring && ticket.status !== 'done'}Die Regel läuft weiter.{/if}
</p>
{#if subtaskCount > 0}
	<p>{subtasksAlongText(subtaskCount)}</p>
{/if}
{#if sourceCount > 0}
	<p>{sourceCountText(sourceCount)}</p>
{/if}
