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
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { projectColorOf, ticketColorOf, type ShownColor } from '$lib/domain/colors';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import { SOURCE_FAMILY_LABELS, sourceFamily } from '$lib/domain/source';
	import { progressLabel, type SubtaskProgress } from '$lib/domain/subtasks';
	import type { ParentRef, ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
	import { PRIORITY_LABELS, STATUS_LABELS } from '$lib/domain/labels';
	import { PRIORITIES, STATUSES } from '$lib/domain/status';
	import CharmIcon from './CharmIcon.svelte';
	import ColorMark from './ColorMark.svelte';
	import DoneToggle from './DoneToggle.svelte';
	import DueLabel from './DueLabel.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import StatusPill from './StatusPill.svelte';
	import TagPicker from './TagPicker.svelte';
	import DueEditor from './table/DueEditor.svelte';
	import EditableCell from './table/EditableCell.svelte';
	import type { RowEdit } from './table/row-edit';

	// One row of the ticket table (E3 plan, T-4): key, priority, status, title with the symbol of
	// its source (ADR-0019 section 4), its charm (ADR-0062) and the recurring icon, project, tags, due date, creation
	// date and the actions (check mark and "Öffnen"; "Rückgängig" stands in the flag since UI-5).
	// The title is the link to the detail panel and the keyboard target; a mouse click anywhere else
	// in the row outside of controls follows the same link. Compact (ADR-0030 section 6, SP-4): the
	// title takes at most two lines, the tags one line with "+N" for the rest, so a row is never
	// higher than two lines of title. Sub-tasks (ADR-0033 section 5): a parent carries the chip
	// "2/5" at its title; a sub-task is indented below its parent or, standing alone, shows the path
	// hint "HAUS-12 ›"; screen readers hear "Unteraufgabe von HAUS-12" either way.
	// With `edit` (plan BI-3, ADR-0036 §6) priority, status, project, tags and due date are buttons
	// that edit the value in a small popover; a click in those cells never opens the ticket. With
	// `menu` (plan aktionsmenues, AM-2) the actions end with the menu "•••" of the ticket, after
	// "Öffnen"; a click on it or in the menu never opens the row either. The title link and
	// "Öffnen" open the row itself (data-row-link): a right click on them opens the menu of the
	// row, not the one of the browser (AM-3, the table handles it). The color of the ticket
	// (ADR-0052: its own, else of its project or the parent of that) is a stripe at the start of the
	// first cell, apart from the bar of the open row at the very edge, with its name for screen
	// readers; the row keeps its height.
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
		selected = false,
		onselect,
		edit,
		menu,
		menuBusy = false,
		pin,
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
		/** The row is chosen for a bulk action (plan BI-2). */
		selected?: boolean;
		/**
		 * The checkbox of the selection changed to `on`; `range` with Shift. Without it the row has
		 * no selection cell (single rows in tests).
		 */
		onselect?: (on: boolean, range: boolean) => void;
		/** Editing in the cells (plan BI-3); without it the cells only show their value. */
		edit?: RowEdit;
		/** The menu "•••" of the ticket at the end of the actions (plan aktionsmenues, AM-2). */
		menu?: Snippet<[TicketSummary]>;
		/** A dialog of the menu is being prepared for this row (aria-busy on the actions). */
		menuBusy?: boolean;
		/**
		 * The pin toggle of the ticket (ADR-0064) at the end of the title cell, apart from the charm
		 * before the title; the row marks itself for its "show on pointing" (data-pin-row).
		 */
		pin?: Snippet<[TicketSummary]>;
		ontoggle: (done: boolean) => void;
	} = $props();

	/** Text typed into the tag input of the cell (plan BI-3). */
	let tagText = $state('');
	let tagError = $state<string | null>(null);
	const tagIds = $derived(tags.map((tag) => tag.id));

	async function addTag(tagId: string): Promise<boolean> {
		if (!edit || tagIds.includes(tagId)) return true;
		tagError = null;
		return edit.save({ tags: [...tagIds, tagId] });
	}

	async function removeTag(tagId: string): Promise<boolean> {
		if (!edit) return false;
		tagError = null;
		return edit.save({ tags: tagIds.filter((id) => id !== tagId) });
	}

	async function createTag(name: string): Promise<boolean> {
		if (!edit) return false;
		const result = await edit.createTag(name);
		if (!result.ok) {
			tagError = result.message;
			return false;
		}
		return addTag(result.tag.id);
	}

	/** Chooses a value from a menu: the menu closes first, the cell keeps the focus. */
	function choose(close: () => void, patch: Parameters<RowEdit['save']>[0]) {
		close();
		void edit?.save(patch);
	}

	/** Shift held on the last pointer or key press in the selection cell (a range, plan BI-2). */
	let rangeHeld = false;

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
	const shownColor = $derived(ticketColorOf(ticket, project));
	/** Name of the recurring symbol: "Wiederkehrend: jeden Montag", or only "wiederkehrend". */
	const recurringLabel = $derived(
		recurrenceText === '' ? 'wiederkehrend' : `Wiederkehrend: ${recurrenceText}`
	);
	const createdDate = $derived(berlinDateOf(ticket.created));

	/**
	 * Controls of the row handle their own clicks; the row only takes clicks outside of them. The
	 * selection cell never opens the ticket (plan BI-2).
	 */
	const CONTROLS = 'a, button, input, select, textarea, label, [popover], [data-col="select"]';

	function onclick(event: MouseEvent) {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
		// Selecting text in the row does not open the ticket.
		if ((window.getSelection()?.toString() ?? '') !== '') return;
		void goto(href);
	}
</script>

<!-- One choice of a cell menu (plan BI-3): the current value is checked, by mark and weight. A
     project shows its color as a dot (ADR-0052); its name is the text of the choice. -->
{#snippet menuChoice(
	checked: boolean,
	text: string,
	onchoose: () => void,
	color: ShownColor | null = null
)}
	<button
		class="item"
		class:checked
		type="button"
		role="menuitemradio"
		aria-checked={checked}
		tabindex="-1"
		onclick={onchoose}
	>
		<span class="mark" aria-hidden="true">{checked ? '✓' : ''}</span>{#if color}<span
				class="choice-color"><ColorMark shown={color} named={false} /></span
			>{/if}{text}
	</button>
{/snippet}

{#snippet projectValue()}
	{#if project}
		<!-- A sub project shows its path "Haus › Garten" (ADR-0034); the title adds the code. -->
		<span title={projectChoiceLabel(project)}>{projectPath(project)}</span>
	{/if}
{/snippet}

{#snippet colorStripe()}
	{#if shownColor}
		<span class="color-slot"><ColorMark shown={shownColor} kind="stripe" /></span>
	{/if}
{/snippet}

{#snippet tagsValue()}
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
{/snippet}

<!-- The title link is the keyboard target of the row; the click on the row is a mouse shortcut. -->
<tr
	class="row"
	class:done
	class:active
	class:nested
	class:selected
	data-ticket-id={ticket.id}
	data-pin-row={pin ? '' : undefined}
	{onclick}
>
	{#if onselect && shows('select')}
		<!-- The whole cell is the label: a click anywhere in it chooses, never opens the ticket. -->
		<td class="select" data-col="select" onpointerdown={(event) => (rangeHeld = event.shiftKey)}>
			{@render colorStripe()}
			<label class="select-hit">
				<input
					type="checkbox"
					aria-label={`${ticket.key} auswählen`}
					checked={selected}
					onkeydown={(event) => (rangeHeld = event.shiftKey)}
					onchange={(event) => {
						const range = rangeHeld;
						rangeHeld = false;
						onselect(event.currentTarget.checked, range);
					}}
				/>
			</label>
		</td>
	{/if}
	<td class="key" data-col="key">
		{#if !(onselect && shows('select'))}{@render colorStripe()}{/if}{#if isNew}<span
				class="new-dot"
				title="Neu"><span class="visually-hidden">neu,</span></span
			>{/if}{ticket.key}
	</td>
	{#if shows('priority')}
		<td class="priority" class:editable={edit} data-col="priority">
			{#if edit}
				<EditableCell
					kind="menu"
					label={`Priorität von ${ticket.key}`}
					buttonLabel={`Priorität von ${ticket.key}: ${PRIORITY_LABELS[ticket.priority]}, ändern`}
					busy={edit.busy}
				>
					{#snippet value()}<PriorityIcon priority={ticket.priority} />{/snippet}
					{#snippet editor({ close })}
						{#each PRIORITIES as value (value)}
							{@render menuChoice(value === ticket.priority, PRIORITY_LABELS[value], () =>
								choose(close, { priority: value })
							)}
						{/each}
					{/snippet}
				</EditableCell>
			{:else}
				<PriorityIcon priority={ticket.priority} />
			{/if}
		</td>
	{/if}
	{#if shows('status')}
		<td class="status" class:editable={edit} data-col="status">
			{#if edit}
				<EditableCell
					kind="menu"
					label={`Status von ${ticket.key}`}
					buttonLabel={`Status von ${ticket.key}: ${STATUS_LABELS[ticket.status]}, ändern`}
					busy={edit.busy}
				>
					{#snippet value()}<StatusPill status={ticket.status} />{/snippet}
					{#snippet editor({ close })}
						{#each STATUSES as value (value)}
							{@render menuChoice(value === ticket.status, STATUS_LABELS[value], () =>
								choose(close, { status: value })
							)}
						{/each}
					{/snippet}
				</EditableCell>
			{:else}
				<StatusPill status={ticket.status} />
			{/if}
		</td>
	{/if}
	<th class="title" class:has-pin={pin} scope="row" data-col="title">
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
			<CharmIcon charm={ticket.charm} />
			<a
				class="title-link"
				{href}
				data-row-link
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
		{#if pin}
			<!-- The pin toggle (ADR-0064) at the end of the cell; the charm stays before the title. -->
			<span class="pin-slot">{@render pin(ticket)}</span>
		{/if}
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
		<td class="project" class:editable={edit} data-col="project">
			{#if edit}
				<EditableCell
					kind="menu"
					label={`Projekt von ${ticket.key}`}
					buttonLabel={`Projekt von ${ticket.key}: ${project ? projectChoiceLabel(project) : 'kein Projekt'}, ändern`}
					busy={edit.busy}
				>
					{#snippet value()}{@render projectValue()}{/snippet}
					{#snippet editor({ close })}
						{@render menuChoice(ticket.projectId === null, 'Kein Projekt', () =>
							choose(close, { project: null })
						)}
						{#each edit.projects as choice (choice.id)}
							{@render menuChoice(
								choice.id === ticket.projectId,
								projectChoiceLabel(choice),
								() => choose(close, { project: choice.id }),
								projectColorOf(choice)
							)}
						{/each}
					{/snippet}
				</EditableCell>
			{:else}
				{@render projectValue()}
			{/if}
		</td>
	{/if}
	{#if shows('tags')}
		<td class="tags" class:editable={edit} data-col="tags">
			{#if edit}
				<EditableCell
					kind="panel"
					label={`Tags von ${ticket.key}`}
					buttonLabel={`Tags von ${ticket.key}: ${tags.length === 0 ? 'keine' : tags.map((tag) => tag.name).join(', ')}, ändern`}
					busy={edit.busy}
				>
					{#snippet value()}{@render tagsValue()}{/snippet}
					{#snippet editor()}
						<div class="tags-editor">
							<label for={`${ticket.id}-tags`}>Tags von {ticket.key}</label>
							<TagPicker
								id={`${ticket.id}-tags`}
								selected={tags}
								tags={edit.tags}
								bind:text={tagText}
								busy={edit.busy}
								error={tagError}
								errorId={`${ticket.id}-tags-error`}
								onadd={addTag}
								onremove={removeTag}
								oncreate={createTag}
							/>
						</div>
					{/snippet}
				</EditableCell>
			{:else}
				{@render tagsValue()}
			{/if}
		</td>
	{/if}
	{#if shows('due')}
		<td class="due" class:editable={edit} data-col="due">
			{#if edit}
				<EditableCell
					kind="panel"
					label={`Fälligkeit von ${ticket.key}`}
					buttonLabel={`Fälligkeit von ${ticket.key}: ${ticket.due === null ? 'keine' : formatCalendarDate(ticket.due)}, ändern`}
					busy={edit.busy}
				>
					{#snippet value()}<DueLabel due={ticket.due} {today} {done} />{/snippet}
					{#snippet editor({ close })}
						<DueEditor
							key={ticket.key}
							value={ticket.due}
							onsave={(due) => edit.save({ due })}
							{close}
						/>
					{/snippet}
				</EditableCell>
			{:else}
				<DueLabel due={ticket.due} {today} {done} />
			{/if}
		</td>
	{/if}
	{#if shows('created')}
		<td class="created" data-col="created">
			<time datetime={createdDate} title={formatBerlinDateTime(ticket.created)}>
				{formatCalendarDate(createdDate)}
			</time>
		</td>
	{/if}
	<td class="actions" data-col="actions" aria-busy={menuBusy ? 'true' : undefined}>
		<span class="action-group">
			<DoneToggle key={ticket.key} {checked} {pending} onchange={ontoggle} />
			<!-- Mouse only: the title link does the same for keyboard and screen readers. -->
			<a class="open" {href} tabindex="-1" aria-hidden="true" title="Öffnen" data-row-link>
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
			{@render menu?.(ticket)}
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

	.row.active,
	.row.selected {
		background: var(--color-brand-soft-bg);
	}

	/* Cells edited in place (plan BI-3): the button of EditableCell fills the cell. */
	td.editable {
		padding: 0;
	}

	.priority.editable :global(button.cell-edit) {
		justify-content: center;
	}

	.tags-editor {
		display: grid;
		gap: 0.375rem;
		min-width: 16rem;
		padding: 0.25rem;
	}

	.tags-editor label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.mark {
		display: inline-block;
		width: 1.25em;
	}

	.choice-color {
		margin-right: 0.375rem;
	}

	.item.checked {
		font-weight: 600;
	}

	/* The selection (plan BI-2): the label fills the cell, so a click beside the box chooses too. */
	.select {
		padding: 0;
		text-align: center;
		user-select: none;
	}

	.select-hit {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		cursor: pointer;
	}

	/* Second, non-colour mark of the open row: a bar at its start. */
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	/*
	 * The color of the ticket (ADR-0052): a stripe of 0.25rem at the start of the first cell, 3px
	 * after the bar of the open row, as high as the row less its padding, so the row keeps its height
	 * with one or two lines of title.
	 */
	.select,
	.key {
		position: relative;
	}

	.color-slot {
		position: absolute;
		top: 0.375rem;
		bottom: 0.375rem;
		left: 0.375rem;
		display: flex;
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

	/*
	 * The pin toggle (ADR-0064) at the right end of the title cell, centred; the title keeps the
	 * room it needs beside it (small control height, 44 px on touch screens, ADR-0060).
	 */
	.title.has-pin {
		--pin-size: var(--control-height-s);
		position: relative;
		/* A table cell takes its height as the least height: the toggle is never cut off. */
		height: var(--pin-size);
		padding-right: calc(var(--pin-size) + 0.75rem);
	}

	.pin-slot {
		position: absolute;
		top: 50%;
		right: 0.375rem;
		display: flex;
		transform: translateY(-50%);
	}

	@media (pointer: coarse) {
		.title.has-pin {
			--pin-size: var(--control-height-touch);
		}
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

	/*
	 * Check mark, "Öffnen" and the menu "•••" in 5.5rem (ADR-0030, addendum of plan aktionsmenues):
	 * a narrower padding; base.css gives the button of the menu the small control height
	 * (`.row-menu`), so the row keeps its height.
	 */
	.actions {
		padding-inline: 0.5rem;
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
