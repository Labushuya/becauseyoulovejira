<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import type { ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
	import DoneToggle from './DoneToggle.svelte';
	import DueLabel from './DueLabel.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import StatusPill from './StatusPill.svelte';

	// One row of the ticket table (E3 plan, T-4): key, priority, status, title with the recurring
	// icon, project, tags, due date, creation date and the actions (check mark, "Rückgängig" and
	// "Öffnen"). The title is the link to the detail panel and the keyboard target; a mouse click
	// anywhere else in the row outside of controls follows the same link.
	let {
		ticket,
		project,
		tags,
		href,
		today,
		checked,
		pending,
		lingering,
		active = false,
		ontoggle,
		onundo
	}: {
		ticket: TicketSummary;
		/** Project resolved through the catalog (T-16). */
		project: ProjectRef | null;
		/** Tags resolved through the catalog. */
		tags: readonly TagRef[];
		href: ResolvedPathname;
		today: CalendarDate;
		checked: boolean;
		pending: boolean;
		/** Just checked: struck through, with "Rückgängig" (P-5). */
		lingering: boolean;
		/** The detail panel shows this ticket. */
		active?: boolean;
		ontoggle: (done: boolean) => void;
		onundo: () => void;
	} = $props();

	const done = $derived(ticket.status === 'done');
	const createdDate = $derived(berlinDateOf(ticket.created));

	/** Controls of the row handle their own clicks; the row only takes clicks outside of them. */
	const CONTROLS = 'a, button, input, select, textarea, label';

	function onclick(event: MouseEvent) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
		// Selecting text in the row does not open the ticket.
		if ((window.getSelection()?.toString() ?? '') !== '') return;
		void goto(href);
	}
</script>

<!-- The title link is the keyboard target of the row; the click on the row is a mouse shortcut. -->
<tr class="row" class:done class:lingering class:active data-ticket-id={ticket.id} {onclick}>
	<td class="key">{ticket.key}</td>
	<td class="priority"><PriorityIcon priority={ticket.priority} /></td>
	<td class="status"><StatusPill status={ticket.status} /></td>
	<th class="title" scope="row">
		<a class="title-link" {href} aria-current={active ? 'page' : undefined}>{ticket.title}</a>
		{#if ticket.recurring}
			<span class="recurring-icon" title="Wiederkehrend">
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
					<path
						d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<path
						d="M3.25 1.75v3h3M12.75 14.25v-3h-3"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span class="visually-hidden">wiederkehrend</span>
			</span>
		{/if}
	</th>
	<td class="project">
		{#if project}
			<span title={`${project.name} (${project.code})`}>{project.name}</span>
		{/if}
	</td>
	<td class="tags">
		{#each tags as tag (tag.id)}
			<span class="tag">{tag.name}</span>
		{/each}
	</td>
	<td class="due">
		{#if ticket.due}
			<DueLabel due={ticket.due} {today} {done} />
		{/if}
	</td>
	<td class="created">
		<time datetime={createdDate} title={formatBerlinDateTime(ticket.created)}>
			{formatCalendarDate(createdDate)}
		</time>
	</td>
	<td class="actions">
		<span class="action-group">
			<DoneToggle key={ticket.key} {checked} {pending} onchange={ontoggle} />
			{#if lingering}
				<button
					class="undo"
					type="button"
					aria-label={`Rückgängig: ${ticket.key} wieder öffnen`}
					disabled={pending}
					onclick={onundo}
				>
					Rückgängig
				</button>
			{/if}
			<!-- Mouse only: the title link does the same for keyboard and screen readers. -->
			<a class="open" {href} tabindex="-1" aria-hidden="true" title="Öffnen">
				<svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
					<path
						d="M6 3.5h-2.5v9h9V10M9 3h4v4M13 3l-6 6"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</a>
		</span>
	</td>
</tr>

<style>
	.row {
		cursor: pointer;
		border-bottom: 1px solid var(--color-line);
	}

	.row:hover {
		background: var(--color-bg);
	}

	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the open row: a bar at its start. */
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	td,
	th {
		padding: 0.375rem 0.75rem;
		text-align: left;
		vertical-align: middle;
	}

	.key {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.priority {
		text-align: center;
	}

	.title {
		font-weight: 400;
	}

	.title-link {
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.recurring-icon {
		display: inline-flex;
		margin-left: 0.375rem;
		vertical-align: middle;
		color: var(--color-text-muted);
	}

	.project {
		max-width: 12rem;
		overflow: hidden;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tags {
		font-size: 0.75rem;
	}

	.tag {
		display: inline-block;
		margin: 0.0625rem 0.25rem 0.0625rem 0;
		padding: 0 0.375rem;
		line-height: 1.125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}

	.created {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.action-group {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}

	.open {
		display: inline-flex;
		color: var(--color-text-muted);
	}

	.open:hover {
		color: var(--color-brand-text);
	}

	/* Done tickets step back (CLAUDE.md section 8). */
	.done .title-link,
	.done .key {
		color: var(--color-text-muted);
	}

	.lingering .title-link {
		text-decoration: line-through;
	}

	.undo {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-brand-text);
		white-space: nowrap;
		background: none;
		border: 1px solid var(--color-brand);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.undo:disabled {
		cursor: progress;
		opacity: 0.6;
	}
</style>
