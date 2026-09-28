<script lang="ts" module>
	import {
		TICKET_TABLE,
		defaultColumnPrefs,
		estimateTextWidth,
		fitChips,
		moreChipText,
		type MeasureText
	} from '$lib/domain/columns';

	const HIDDEN_BY_DEFAULT: readonly string[] = defaultColumnPrefs(TICKET_TABLE.columns).hidden;
	/** Room for chips in the default tag column: its width without the padding of 1.5rem. */
	const DEFAULT_TAGS_SPACE =
		(TICKET_TABLE.columns.find((column) => column.id === 'tags')?.width ?? 0) - 24;
	/** Gap between two chips (0.25rem). */
	const CHIP_GAP = 4;
	/** Titles from this length get a tooltip with the whole text (only they can be cut off). */
	const LONG_TITLE = 60;

	/** Chip without a canvas: text at 12 px plus padding and border. */
	function estimateChip(text: string): number {
		return estimateTextWidth(text, 12) + 14;
	}
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import { SOURCE_FAMILY_LABELS, sourceFamily } from '$lib/domain/source';
	import { progressLabel, type SubtaskProgress } from '$lib/domain/subtasks';
	import type { ParentRef, ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
	import DoneToggle from './DoneToggle.svelte';
	import DueLabel from './DueLabel.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import StatusPill from './StatusPill.svelte';

	// One row of the ticket table (E3 plan, T-4): key, priority, status, title with the symbol of
	// its source (ADR-0019 section 4) and the recurring icon, project, tags, due date, creation
	// date and the actions (check mark and "Öffnen"; "Rückgängig" stands in the flag since UI-5).
	// The title is the link to the detail panel and the keyboard target; a mouse click anywhere else
	// in the row outside of controls follows the same link. Compact (ADR-0030 section 6, SP-4): the
	// title takes at most two lines, the tags one line with "+N" for the rest, so a row is never
	// higher than two lines of title. Sub-tasks (ADR-0033 section 5): a parent carries the chip
	// "2/5" at its title; a sub-task is indented below its parent or, standing alone, shows the path
	// hint "HAUS-12 ›"; screen readers hear "Unteraufgabe von HAUS-12" either way.
	let {
		ticket,
		nested = false,
		parent = null,
		progress = null,
		project,
		tags,
		href,
		today,
		checked,
		pending,
		active = false,
		isNew = false,
		recurrenceText = '',
		columns,
		tagsSpace = DEFAULT_TAGS_SPACE,
		measure = estimateChip,
		ontoggle
	}: {
		ticket: TicketSummary;
		/** Indented directly below its parent (ADR-0033 section 5). */
		nested?: boolean;
		/** The parent of a sub-task, null for a top-level ticket. */
		parent?: ParentRef | null;
		/** Progress of the sub-tasks of this ticket; null or total 0 without a chip. */
		progress?: SubtaskProgress | null;
		/** Project resolved through the catalog (T-16). */
		project: ProjectRef | null;
		/** Tags resolved through the catalog. */
		tags: readonly TagRef[];
		href: ResolvedPathname;
		today: CalendarDate;
		checked: boolean;
		pending: boolean;
		/** The detail panel shows this ticket. */
		active?: boolean;
		/** New for the signed-in user (ADR-0015): a dot before the key, "neu" for screen readers. */
		isNew?: boolean;
		/** Rhythm of the series ("jeden Montag"), '' while unknown (E5 plan, package 4). */
		recurrenceText?: string;
		/** Shown columns of the table (ADR-0030); without it the columns shown by default. */
		columns?: ReadonlySet<string>;
		/** Room for the chips in the tag column in CSS pixels (its width without the padding). */
		tagsSpace?: number;
		/** Width of a whole tag chip (canvas in the browser, estimated without). */
		measure?: MeasureText;
		ontoggle: (done: boolean) => void;
	} = $props();

	function shows(id: string): boolean {
		return columns === undefined ? !HIDDEN_BY_DEFAULT.includes(id) : columns.has(id);
	}

	const chips = $derived(
		fitChips(
			tags.map((tag) => tag.name),
			tagsSpace,
			measure,
			CHIP_GAP
		)
	);

	const done = $derived(ticket.status === 'done');
	/** Name of the recurring symbol: "Wiederkehrend: jeden Montag", or only "wiederkehrend". */
	const recurringLabel = $derived(
		recurrenceText === '' ? 'wiederkehrend' : `Wiederkehrend: ${recurrenceText}`
	);
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
<tr class="row" class:done class:active class:nested data-ticket-id={ticket.id} {onclick}>
	<td class="key" data-col="key">
		{#if isNew}<span class="new-dot" title="Neu"><span class="visually-hidden">neu,</span></span
			>{/if}{ticket.key}
	</td>
	{#if shows('priority')}
		<td class="priority" data-col="priority"><PriorityIcon priority={ticket.priority} /></td>
	{/if}
	{#if shows('status')}
		<td class="status" data-col="status"><StatusPill status={ticket.status} /></td>
	{/if}
	<th class="title" scope="row" data-col="title">
		<!-- At most two lines, cut off only visually; screen readers read the whole title. -->
		<div class="title-clamp">
			{#if parent}
				<span class="visually-hidden">Unteraufgabe von {parent.key}:</span>
				{#if nested}
					<!-- Indented below its parent: a corner instead of the path. -->
					<svg
						class="nest-icon"
						viewBox="0 0 16 16"
						width="12"
						height="12"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M4 2.5v6.5h8.5M10 6.5l2.5 2.5L10 11.5" />
					</svg>
				{:else}
					<span class="path" aria-hidden="true" title={parent.title || undefined}
						>{parent.key} ›</span
					>
				{/if}
			{/if}
			<SourceIcon source={ticket.source} />
			<a
				class="title-link"
				{href}
				title={ticket.title.length >= LONG_TITLE ? ticket.title : undefined}
				aria-current={active ? 'page' : undefined}>{ticket.title}</a
			>
			{#if ticket.recurring}
				<span
					class="recurring-icon"
					title={recurrenceText === '' ? 'Wiederkehrend' : `Wiederkehrend: ${recurrenceText}`}
				>
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
					<span class="visually-hidden">{recurringLabel}</span>
				</span>
			{/if}
			{#if progress && progress.total > 0}
				<span class="progress-chip" title={progressLabel(progress)}>
					<span aria-hidden="true">{progress.done}/{progress.total}</span>
					<span class="visually-hidden">, {progressLabel(progress)}</span>
				</span>
			{/if}
		</div>
	</th>
	{#if shows('parent')}
		<td class="parent" data-col="parent">
			{#if parent}
				<span title={parent.title || undefined}>{parent.key}</span>
			{/if}
		</td>
	{/if}
	{#if shows('source')}
		<td class="source" data-col="source">{SOURCE_FAMILY_LABELS[sourceFamily(ticket.source)]}</td>
	{/if}
	{#if shows('project')}
		<td class="project" data-col="project">
			{#if project}
				<!-- A sub project shows its path "Haus › Garten" (ADR-0034); the title adds the code. -->
				<span title={projectChoiceLabel(project)}>{projectPath(project)}</span>
			{/if}
		</td>
	{/if}
	{#if shows('tags')}
		<td class="tags" data-col="tags">
			{#if chips.rest.length === 0}
				<span class="chips">
					{#each tags as tag (tag.id)}
						<span class="tag">{tag.name}</span>
					{/each}
				</span>
			{:else}
				<!-- One line: the chips that fit and "+N"; the whole list for screen readers. -->
				<span class="chips" aria-hidden="true">
					{#each chips.shown as name, index (index)}
						<span class="tag">{name}</span>
					{/each}
					<span class="tag more" title={`Weitere Tags: ${chips.rest.join(', ')}`}
						>{moreChipText(chips.rest.length)}</span
					>
				</span>
				<span class="visually-hidden">{tags.map((tag) => tag.name).join(', ')}</span>
			{/if}
		</td>
	{/if}
	{#if shows('due')}
		<td class="due" data-col="due"><DueLabel due={ticket.due} {today} {done} /></td>
	{/if}
	{#if shows('created')}
		<td class="created" data-col="created">
			<time datetime={createdDate} title={formatBerlinDateTime(ticket.created)}>
				{formatCalendarDate(createdDate)}
			</time>
		</td>
	{/if}
	<td class="actions" data-col="actions">
		<span class="action-group">
			<DoneToggle key={ticket.key} {checked} {pending} onchange={ontoggle} />
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

	/* Fixed widths (ADR-0030): what does not fit is cut off inside its cell, never beside it. */
	td,
	th {
		padding: 0.375rem 0.75rem;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		vertical-align: middle;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.priority {
		text-align: center;
	}

	/* "Neu" (ADR-0015 section 5): a dot with a text for screen readers and a title, not only colour. */
	.new-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.375rem;
		vertical-align: middle;
		background: var(--color-brand);
		border-radius: 50%;
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

	/* Sub-tasks (ADR-0033 section 5): indented below the parent, or the parent's key as path. */
	.nested .title {
		padding-left: 2rem;
	}

	.nest-icon {
		margin-right: 0.25rem;
		vertical-align: middle;
		color: var(--color-text-muted);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.path {
		margin-right: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* Progress of the sub-tasks of a parent: "2/5". */
	.progress-chip {
		display: inline-block;
		margin-left: 0.375rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		line-height: 1.125rem;
		font-variant-numeric: tabular-nums;
		vertical-align: middle;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.parent {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.status,
	.due,
	.actions {
		white-space: nowrap;
	}

	.source,
	.project {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* Two lines at most (ADR-0030 section 6); the clamp is visual only. */
	.title-clamp {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* One line of chips; fitChips decides how many, "+N" stands for the rest. */
	.tags {
		font-size: var(--font-size-small);
		white-space: nowrap;
	}

	.chips {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
	}

	.tag {
		flex: 0 0 auto;
		padding: 0 0.375rem;
		overflow: hidden;
		line-height: 1.125rem;
		color: var(--color-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-item);
	}

	/* A single chip that is too long shrinks with an ellipsis; "+N" never shrinks. */
	.tag:first-child {
		flex-shrink: 1;
		min-width: 0;
	}

	.tag.more {
		font-variant-numeric: tabular-nums;
	}

	.created {
		font-size: var(--font-size-control);
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
</style>
