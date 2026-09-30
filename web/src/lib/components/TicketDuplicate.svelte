<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import type { ProjectRef, Ticket } from '$lib/domain/ticket';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import DuplicateDialog from './DuplicateDialog.svelte';

	// "Duplizieren …" of a ticket (ADR-0045 §1): a symbol button in the header of the side panel and
	// of the full view, before "Löschen …" (the header is narrow; CLAUDE.md section 8). In the side
	// panel it opens the question as a modal M and returns the focus itself. The full view is a
	// modal and opens no dialog (ADR-0025 addendum 16): with `inline` the button only asks the owner
	// to show the question in its content, and says whether it is shown (aria-expanded).
	let {
		ticket,
		store,
		projects,
		sources = [],
		commentCount = 0,
		subtaskCount = 0,
		parentKey = null,
		onopen,
		inline = false,
		asking = false,
		onask,
		button = $bindable()
	}: {
		ticket: Ticket;
		store: TicketDuplicateStore;
		/** Projects a ticket can join (the active ones, in tree order). */
		projects: readonly ProjectRef[];
		sources?: readonly InboxItemSummary[];
		commentCount?: number;
		subtaskCount?: number;
		parentKey?: string | null;
		/** Opens a ticket in the remembered way. */
		onopen: (ticketId: string) => void;
		/** Full view: the question stands inline in the content, not in a dialog. */
		inline?: boolean;
		/** Inline: the question is shown (aria-expanded). */
		asking?: boolean;
		/** Inline: shows or hides the question. */
		onask?: () => void;
		/** The button, for the focus after the inline question. */
		button?: HTMLButtonElement;
	} = $props();

	let open = $state(false);

	function ask() {
		if (inline) onask?.();
		else open = true;
	}
</script>

<button
	class="button-icon duplicate"
	type="button"
	aria-label="Duplizieren …"
	title="Duplizieren …"
	aria-haspopup={inline ? undefined : 'dialog'}
	aria-expanded={inline ? asking : undefined}
	bind:this={button}
	onclick={ask}
>
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
		<path d="M6 5.5h7v8H6zM3.5 10.5V2.5H10" />
	</svg>
</button>

{#if !inline && open}
	<DuplicateDialog
		{ticket}
		{projects}
		{sources}
		{commentCount}
		{subtaskCount}
		{parentKey}
		{store}
		{onopen}
		onclose={() => (open = false)}
	/>
{/if}

<style>
	/* Drawn like the icons of the header of the panel and the modal. */
	.duplicate svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
