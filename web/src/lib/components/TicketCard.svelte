<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { projectColorOf, ticketColorOf } from '$lib/domain/colors';
	import { OFFLINE_TEXTS, keyLabel, ticketName } from '$lib/domain/offline';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import type { Status } from '$lib/domain/status';
	import type { SubtaskProgress } from '$lib/domain/subtasks';
	import type { ParentRef, ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
	import { isCardTap } from '$lib/card-tap';
	import type { AssigneeSource } from '$lib/stores/assignees.svelte';
	import { findFlagStore } from '$lib/stores/flags.svelte';
	import AssigneeBadge from './AssigneeBadge.svelte';
	import CharmIcon from './CharmIcon.svelte';
	import ColorMark from './ColorMark.svelte';
	import DoneToggle from './DoneToggle.svelte';
	import DueLabel from './DueLabel.svelte';
	import KindBadge from './KindBadge.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import SubtaskNestIcon from './SubtaskNestIcon.svelte';
	import SubtaskPath from './SubtaskPath.svelte';
	import SubtaskProgressChip from './SubtaskProgressChip.svelte';
	import StatusMenu from './table/StatusMenu.svelte';
	import PendingMark from './offline/PendingMark.svelte';

	// A ticket of "Aufgaben" as a card in the phone frame (MO-3, ADR-0073 addendum MO-3; concept MO-0
	// §3.2): the counterpart of a row of the table (TicketTableRow), rendered by the same TicketTable
	// with the same store, links, menus and parts. First line: the check mark in a target of 44 px,
	// the title (up to three lines, the link that opens the ticket, with the path of a sub-task, the
	// symbol of its source and its charm before it), the pin and "•••". Second line, muted and
	// wrapping: the key with the dot "neu", the status pill as the menu of the status (StatusMenu, as
	// in the cell), the priority, the due date, the project with its color, the initials of the
	// assignee, the progress "2/5", "wiederkehrend", "Vorhaben" and the number of tags. The columns
	// left out ("Erstellt", the text of the source, the tags themselves, editing in the other cells)
	// are in the ticket, one level deeper. A tap on the card outside of its controls opens the ticket
	// like the click on a row; while choosing (`selecting`, "Auswählen") the check mark gives way to
	// the box of the selection, and the tap chooses. The color of the ticket (ADR-0052) is a stripe at
	// its start; done tickets step back. A card that cannot be chosen (a ticket "＋" created, OF-4b B-1)
	// shows its box locked while choosing, never the check mark: a tap completes nothing and names the
	// reason in a flag.
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
		selecting = false,
		selected = false,
		onselect,
		locked = null,
		statusBusy = false,
		onstatus,
		assignees = null,
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
		project: ProjectRef | null;
		tags: readonly TagRef[];
		href: ResolvedPathname;
		today: CalendarDate;
		checked: boolean;
		pending: boolean;
		/** The detail panel shows this ticket. */
		active?: boolean;
		/** New for the signed-in user (ADR-0015): a dot before the key, "neu" for screen readers. */
		isNew?: boolean;
		/** Rhythm of the series ("jeden Montag"), '' while unknown. */
		recurrenceText?: string;
		/** "Auswählen" (plan BI-2 in the frame): the box of the selection instead of the check mark. */
		selecting?: boolean;
		/** The card is chosen for a bulk action. */
		selected?: boolean;
		/**
		 * The box of the selection or a tap on the card changed the choice to `on`. Without it the card
		 * cannot be chosen (a ticket "＋" created, OF-4a round 2, A2): no box, the check mark stays.
		 */
		onselect?: (on: boolean) => void;
		/** Why the card cannot be chosen (OF-4b, B-1); its box stands locked while choosing. */
		locked?: string | null;
		/** A save of this ticket runs (the menu of the status waits). */
		statusBusy?: boolean;
		/** A status chosen in the menu of the pill. */
		onstatus: (status: Status) => void;
		/** "Zuständig" of the household (ADR-0068): the initials; null in the private area. */
		assignees?: AssigneeSource | null;
		/** The menu "•••" of the ticket (TicketActions). */
		menu?: Snippet<[TicketSummary]>;
		/** A dialog of the menu is being prepared for this card. */
		menuBusy?: boolean;
		/** The pin toggle of the ticket (ADR-0064). */
		pin?: Snippet<[TicketSummary]>;
		ontoggle: (done: boolean) => void;
	} = $props();

	/** Titles from this length name themselves on hover (only they can be cut off). */
	const LONG_TITLE = 60;

	const done = $derived(ticket.status === 'done');
	/** The key, or "Neues Ticket „Titel“" for one "＋" created without a key yet (OF-4a). */
	const name = $derived(ticketName(ticket));
	const shownColor = $derived(ticketColorOf(ticket, project));
	const projectColor = $derived(projectColorOf(project));
	const recurringLabel = $derived(
		recurrenceText === '' ? 'Wiederkehrend' : `Wiederkehrend: ${recurrenceText}`
	);
	const tagNames = $derived(tags.map((tag) => tag.name).join(', '));
	/** Choosing this card: "Auswählen" is on and the card may be chosen. */
	const choosing = $derived(selecting && onselect !== undefined);
	const uid = $props.id();
	const flags = findFlagStore();
	/** Why this card stays out of the selection, while choosing (B-1). */
	const lockedReason = $derived(locked ?? OFFLINE_TEXTS.createdLocked);

	/** A tap on the locked box chooses and completes nothing; the flag says why (B-1, B-2). */
	function explainLocked(event: MouseEvent) {
		event.preventDefault();
		flags?.show({ tone: 'info', title: lockedReason });
	}

	/**
	 * Controls of the card handle their own taps; the card only takes taps outside of them. While
	 * choosing, a card that cannot be chosen is not chosen by a tap (OF-4a round 2, A2); since round 2 of
	 * OF-4b (K-4) the tap names the reason in a flag, like its locked box, never silently.
	 */
	function onclick(event: MouseEvent) {
		if (!isCardTap(event)) return;
		if (!selecting) void goto(href);
		else if (onselect !== undefined) onselect(!selected);
		else flags?.show({ tone: 'info', title: lockedReason });
	}
</script>

<!-- The title link is the keyboard target of the card; the tap on the card is a shortcut for it. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<li
	class="card"
	class:done
	class:active
	class:nested
	class:selected
	data-ticket-id={ticket.id}
	data-menu-row={menu ? '' : undefined}
	data-pin-row={pin ? '' : undefined}
	aria-busy={menuBusy ? 'true' : undefined}
	{onclick}
>
	{#if shownColor}
		<span class="color-slot"><ColorMark shown={shownColor} kind="stripe" /></span>
	{/if}
	{#if choosing}
		<!-- The whole target is the label: a tap anywhere in it chooses. -->
		<label class="check-target" data-card-select>
			<input
				type="checkbox"
				aria-label={`${name} auswählen`}
				checked={selected}
				onchange={(event) => onselect?.(event.currentTarget.checked)}
			/>
		</label>
	{:else if selecting}
		<!-- Locked while choosing (B-1): never the check mark; a tap anywhere in the target completes
		     and chooses nothing and names the reason. -->
		<label class="check-target" data-card-locked>
			<input
				type="checkbox"
				aria-label={`${name} auswählen`}
				aria-disabled="true"
				aria-describedby={`${uid}-locked`}
				title={lockedReason}
				checked={false}
				onclick={explainLocked}
			/>
			<span class="visually-hidden" id={`${uid}-locked`}>{lockedReason}</span>
		</label>
	{:else}
		<!-- One tap anywhere in the target completes; the name stays the one of the box. -->
		<label class="check-target" data-card-check>
			<DoneToggle key={name} {checked} {pending} onchange={ontoggle} />
		</label>
	{/if}
	<div class="body">
		<p class="title">
			{#if parent}
				<SubtaskPath {parent} path={!nested} />
				{#if nested}
					<SubtaskNestIcon />
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
		</p>
		<div class="meta">
			<span class="key"
				>{#if isNew}<span class="new-dot" title="Neu"
						><span class="visually-hidden">neu,</span></span
					>{/if}{keyLabel(ticket.key)}<PendingMark id={ticket.id} /></span
			>
			<StatusMenu ticketKey={name} status={ticket.status} busy={statusBusy} onchoose={onstatus} />
			<PriorityIcon priority={ticket.priority} />
			{#if ticket.due !== null}
				<DueLabel due={ticket.due} {today} {done} />
			{/if}
			{#if project}
				<span class="project">
					{#if projectColor}<ColorMark shown={projectColor} named={false} />{/if}
					<span class="visually-hidden">Projekt:</span>
					<span class="project-name" title={projectChoiceLabel(project)}
						>{projectPath(project)}</span
					>
				</span>
			{/if}
			{#if assignees && ticket.assignee}
				<AssigneeBadge assignee={ticket.assignee} context={assignees.context} />
			{/if}
			<SubtaskProgressChip {progress} />
			{#if ticket.recurring}
				<span class="recurring-icon" title={recurringLabel}>
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
			<KindBadge kind={ticket.kind} />
			{#if tags.length > 0}
				<!-- The tags themselves are in the ticket; here their number (concept: "Tags nur als +N"). -->
				<span class="tags" title={`Tags: ${tagNames}`}>
					<span aria-hidden="true">{tags.length === 1 ? '1 Tag' : `${tags.length} Tags`}</span>
					<span class="visually-hidden">Tags: {tagNames}</span>
				</span>
			{/if}
		</div>
	</div>
	<div class="end">
		{#if pin}{@render pin(ticket)}{/if}
		{@render menu?.(ticket)}
	</div>
</li>

<style>
	/*
	 * Only in the phone frame (MO-3, ADR-0073 addendum MO-3): three columns, the check mark in a
	 * target of 44 px, the title block in the rest, the pin and "•••" (44 px from base.css) at the
	 * end; the first line of the title stands level with the targets.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .card {
			position: relative;
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			column-gap: 0.25rem;
			align-items: start;
			padding: 0.25rem 0.25rem 0.25rem 0.5rem;
			border-top: 1px solid var(--color-line);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .card:first-child {
			border-top: none;
		}

		:global(:root[data-mobile-layout='on']) .card.active,
		:global(:root[data-mobile-layout='on']) .card.selected {
			background: var(--color-brand-soft-bg);
		}

		/* Second, non-colour mark of the open ticket: a bar at its start. */
		:global(:root[data-mobile-layout='on']) .card.active {
			box-shadow: inset 3px 0 0 var(--color-brand);
		}

		/* A sub-task directly below its parent: indented, with the corner before its title. */
		:global(:root[data-mobile-layout='on']) .card.nested {
			padding-left: 1.75rem;
		}

		:global(:root[data-mobile-layout='on']) .color-slot {
			position: absolute;
			top: 0.5rem;
			bottom: 0.5rem;
			left: 0.25rem;
			display: flex;
		}

		:global(:root[data-mobile-layout='on']) .check-target {
			display: flex;
			align-items: center;
			justify-content: center;
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
			cursor: pointer;
		}

		/* The target of the locked box while choosing (B-1); the box itself is drawn by base.css. */
		:global(:root[data-mobile-layout='on']) [data-card-locked] {
			cursor: not-allowed;
		}

		:global(:root[data-mobile-layout='on']) .body {
			min-width: 0;
			padding: 0.75rem 0 0.25rem;
		}

		/* Up to three lines; the clamp is visual only, screen readers read the whole title. */
		:global(:root[data-mobile-layout='on']) .title {
			display: -webkit-box;
			margin: 0;
			overflow: hidden;
			font-size: var(--font-size-body);
			overflow-wrap: anywhere;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}

		:global(:root[data-mobile-layout='on']) .title :global(.nest-icon) {
			margin-right: 0.25rem;
		}

		:global(:root[data-mobile-layout='on']) .title-link {
			color: inherit;
			text-decoration: none;
		}

		:global(:root[data-mobile-layout='on']) .meta {
			display: flex;
			flex-wrap: wrap;
			gap: 0 0.75rem;
			align-items: center;
			min-width: 0;
			font-size: var(--font-size-control);
			color: var(--color-text-muted);
		}

		/*
		 * The status pill is the button of its menu, a target of 44 px, not the width of a cell; the
		 * pencil of the cell, shown only on pointing or focus, would hold its room in the line.
		 */
		:global(:root[data-mobile-layout='on']) .meta :global(button.cell-edit) {
			width: auto;
			min-height: var(--control-height-touch);
			margin-inline: -0.25rem;
			padding: 0 0.25rem;
		}

		:global(:root[data-mobile-layout='on']) .meta :global(.edit-hint) {
			display: none;
		}

		:global(:root[data-mobile-layout='on']) .key {
			font-family: var(--font-mono);
			white-space: nowrap;
		}

		/* "Neu" (ADR-0015 section 5): a dot with a text for screen readers, not only colour. */
		:global(:root[data-mobile-layout='on']) .new-dot {
			display: inline-block;
			width: 0.5rem;
			height: 0.5rem;
			margin-right: 0.375rem;
			vertical-align: middle;
			background: var(--color-brand);
			border-radius: 50%;
		}

		:global(:root[data-mobile-layout='on']) .project {
			display: inline-flex;
			gap: 0.25rem;
			align-items: center;
			min-width: 0;
			max-width: 100%;
		}

		:global(:root[data-mobile-layout='on']) .project-name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		:global(:root[data-mobile-layout='on']) .recurring-icon {
			display: inline-flex;
		}

		:global(:root[data-mobile-layout='on']) .tags {
			white-space: nowrap;
		}

		:global(:root[data-mobile-layout='on']) .end {
			display: flex;
			align-items: center;
		}

		/* Done tickets step back (CLAUDE.md section 8). */
		:global(:root[data-mobile-layout='on']) .card.done .title-link,
		:global(:root[data-mobile-layout='on']) .card.done .key {
			color: var(--color-text-muted);
		}
	}
</style>
