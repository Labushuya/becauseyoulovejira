<script lang="ts">
	import {
		assigneeColor,
		assigneeInitials,
		assigneeName,
		assigneeTitle,
		type AssigneeContext
	} from '$lib/domain/assignee';
	import { colorVar } from '$lib/domain/colors';

	// The initials of the assignee of a ticket (E7-5, ADR-0068 §2): a small round mark "AB" in every
	// list, the day plan and the detail. The ring takes a color of the palette of the projects that
	// stays the same for the account (ADR-0052: 3 : 1 on every surface); the initials stand in the text
	// color on the surface, so they keep the contrast of the text. The color is never the only sign:
	// the full name stands as tooltip and as text for screen readers ("Zuständig: Anna Beispiel").
	// Not interactive; nothing without an assignee.
	let {
		assignee,
		context,
		size = 'normal'
	}: {
		/** The account, '' or null for nobody. */
		assignee: string | null | undefined;
		context: AssigneeContext;
		/** `small` in dense rows (calendar). */
		size?: 'normal' | 'small';
	} = $props();

	const name = $derived(assignee ? assigneeName(assignee, context) : '');
	const title = $derived(assigneeTitle(name));
</script>

{#if assignee}
	<span
		class="assignee-badge {size}"
		style:--assignee-ring={colorVar(assigneeColor(assignee))}
		{title}
		data-assignee={assignee}
		><span class="initials" aria-hidden="true">{assigneeInitials(name)}</span><span
			class="visually-hidden">{title}</span
		></span
	>
{/if}

<style>
	.assignee-badge {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1;
		color: var(--color-text);
		background: var(--color-surface);
		border: 2px solid var(--assignee-ring);
		border-radius: 50%;
		vertical-align: middle;
		white-space: nowrap;
	}

	.small {
		width: 1.25rem;
		height: 1.25rem;
		border-width: 1.5px;
	}

	.initials {
		letter-spacing: 0.01em;
	}
</style>
