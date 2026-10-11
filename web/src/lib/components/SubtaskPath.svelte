<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { isKnownParent, subtaskOfText } from '$lib/domain/subtasks';
	import type { ParentRef } from '$lib/domain/ticket';

	// The path of a sub-task (ADR-0033 section 5; TP-2, ADR-0065 Nachtrag TP-2): before its title the
	// parent, for screen readers "Unteraufgabe von HAUS-7:". The table shows "HAUS-7 ›" (the title of
	// the parent as tooltip); a row indented below its parent keeps only the text for screen readers
	// (`path` false, the row draws a corner instead). With `withTitle` (the day plan) it is a small,
	// muted line of context of its own in a wrapping flex row: the key of the parent as a link `href`
	// that opens it, then "› Wochenputz", cut off with an ellipsis on a narrow screen and whole in the
	// tooltip; screen readers hear "Unteraufgabe von HAUS-7 Wochenputz:". An unknown parent ("…",
	// parentOf) shows without a link.
	let {
		parent,
		path = true,
		withTitle = false,
		href
	}: {
		parent: ParentRef;
		/** The visible path "HAUS-7 ›"; false keeps only the text for screen readers. */
		path?: boolean;
		/** The line of context with the title of the parent (day plan). */
		withTitle?: boolean;
		/** Opens the parent (`ticketLinks()`); only with `withTitle`. */
		href?: ResolvedPathname;
	} = $props();
</script>

{#if withTitle}
	<span class="context" data-subtask-path={parent.id}>
		<span class="visually-hidden">{subtaskOfText(parent, true)}</span>
		{#if href !== undefined && isKnownParent(parent)}
			<a class="path-key" {href} data-ticket-link={parent.id}>{parent.key}</a>
		{:else}
			<span class="path-key" aria-hidden="true">{parent.key}</span>
		{/if}
		<span class="path-title" aria-hidden="true" title={parent.title || undefined}
			>› {parent.title}</span
		>
	</span>
{:else}
	<span class="visually-hidden">{subtaskOfText(parent)}</span>
	{#if path}
		<span class="path" aria-hidden="true" title={parent.title || undefined}>{parent.key} ›</span>
	{/if}
{/if}

<style>
	/* The table (ADR-0033 section 5): the key of the parent before the title. */
	.path {
		margin-right: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/*
	 * The day plan (TP-2): a line of its own above the title, never wider than its row. The key stays
	 * whole as long as it fits; the title of the parent gives way first, with an ellipsis.
	 */
	/* Centred, not on the baseline: both parts clip their overflow, and the link is taller on touch. */
	.context {
		display: flex;
		flex: 1 1 100%;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.path-key {
		flex: none;
		max-width: 100%;
		overflow: hidden;
		font-family: var(--font-mono);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a.path-key {
		color: var(--color-brand-text);
		text-decoration: none;
	}

	a.path-key:hover {
		text-decoration: underline;
	}

	.path-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* On a touch screen the link is at least 24 px high (WCAG 2.5.8). */
	@media (pointer: coarse) {
		a.path-key {
			line-height: 1.5rem;
		}
	}
</style>
