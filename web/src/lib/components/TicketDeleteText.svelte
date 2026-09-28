<script lang="ts">
	import { sourceCountText } from '$lib/domain/sources';
	import { remainingSubtasksText } from '$lib/domain/subtasks';
	import type { TicketSummary } from '$lib/domain/ticket';

	// What deleting a ticket takes along and what stays (E2 plan, package 11; ADR-0031, addendum B;
	// ADR-0033 section 4): comments and history go, the rule of a series runs on, sources and
	// sub-tasks stay. Shared by the confirmation of the side panel and the inline question of the
	// full view.
	let {
		ticket,
		sourceCount = 0,
		subtaskCount = 0
	}: {
		ticket: Pick<TicketSummary, 'recurring' | 'status'>;
		sourceCount?: number;
		subtaskCount?: number;
	} = $props();
</script>

<p>
	Dabei werden auch alle Kommentare und der gesamte Verlauf dieses Tickets gelöscht. Das lässt sich
	nicht rückgängig machen.
	{#if ticket.recurring && ticket.status !== 'done'}Die Regel läuft weiter.{/if}
</p>
{#if subtaskCount > 0}
	<p>{remainingSubtasksText(subtaskCount)}</p>
{/if}
{#if sourceCount > 0}
	<p>{sourceCountText(sourceCount)} Sie werden nicht mitgelöscht.</p>
{/if}
