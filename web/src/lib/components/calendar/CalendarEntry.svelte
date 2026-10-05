<script lang="ts" module>
	/**
	 * "dot" a mark only (narrow months), "line" one line (month), "block" key and title (week), "row"
	 * key, title, project, status and priority (agenda and the list of a day).
	 */
	export type EntryLook = 'dot' | 'line' | 'block' | 'row';

	/** Where an entry stands, as the grid or the agenda render it (the snippet `entry`). */
	export interface EntryPlace {
		look: EntryLook;
		/** A stop of Tab; false in the cells of the grid. */
		tabbable: boolean;
		/** The due date as text (the group "Überfällig" of the agenda). */
		dueLabel?: boolean;
		/** Starts moving the due date of the ticket (grid of month and week, K-2); null: not here. */
		move?: (() => void) | null;
		/** The due date of this ticket is moving: the entry is marked as the one that moves. */
		moving?: boolean;
	}
</script>

<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { CALENDAR_MOVE_KEY, type CalendarEntry } from '$lib/domain/calendar';
	import { plannedAppearsText } from '$lib/domain/calendar-plan';
	import { charmOf, charmText } from '$lib/domain/charms';
	import { colorText, ticketColorOf, type ShownColor } from '$lib/domain/colors';
	import { relativeDue } from '$lib/domain/due-label';
	import { CHANNEL_LABELS } from '$lib/domain/inbox';
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { findTicketFollowUpStore } from '$lib/stores/ticket-follow-up.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import ColorMark from '../ColorMark.svelte';
	import PriorityIcon from '../PriorityIcon.svelte';
	import StatusPill from '../StatusPill.svelte';
	import TicketActions from '../TicketActions.svelte';

	// One entry of the calendar (ADR-0053 §4): a ticket, a planned date of a rule or a dated entry of
	// the inbox, always for the whole day. The color of a ticket (ADR-0052: its own, else of its
	// project or the parent of that) stands as a stripe at the start, never as a surface, and its
	// name is part of the link for screen readers, like the project; so is the charm of a ticket or of
	// the template of a planned date, whose symbol stands before the title (ADR-0062; not in the dots
	// of a narrow month). Overdue tickets are bold with a
	// clock and say "überfällig", never red (ADR-0009); done ones are muted with a check mark;
	// planned dates are pale and dashed and say when their ticket appears; entries of the inbox are
	// muted with their symbol. A ticket opens next to the calendar in the remembered way (`href`), a
	// planned date its rule and an entry of the inbox the entry, both next to the calendar too
	// (`ruleHref`, `itemHref`; ADR-0054 §8), marked while their panel is open. Their links name the
	// rule or the entry for the focus after closing. With `rowActions` a ticket ends with the
	// menu "•••" of the rows of "Aufgaben" (plan aktionsmenues); the entry is a menu row, so a right
	// click or Shift+F10 open it where the owner attached rowMenus. In the cells of the grid the
	// entries are no stops of Tab (`tabbable` false): the arrow keys of the grid reach them. An open
	// ticket of the grid may move to another day (`move`, K-2): its link carries `data-movable` for the
	// mouse and the key "m" of the grid, the native dragging of the link is off, and the menu has
	// "Fälligkeit verschieben …". While its due date is saved the entry is busy (`pending`).
	let {
		entry,
		today,
		projectOf,
		href,
		ruleHref,
		itemHref,
		open,
		rowActions = null,
		duplicates = false,
		tabbable = true,
		look = 'line',
		active = false,
		dueLabel = false,
		move = null,
		moving = false,
		pending = false
	}: {
		entry: CalendarEntry;
		today: CalendarDate;
		/** The project of a ticket or a template as the catalog resolves it (with its parent). */
		projectOf: (projectId: string | null) => ProjectRef | null;
		/** Panel or full view of a ticket next to the calendar, in the remembered way. */
		href: (ticketId: string) => ResolvedPathname;
		/** Panel of a rule next to the calendar (a planned date). */
		ruleHref: (ruleId: string) => ResolvedPathname;
		/** Panel of an inbox entry next to the calendar (a date of the inbox). */
		itemHref: (itemId: string) => ResolvedPathname;
		/** Addresses of "Im Seitenpanel öffnen" and "In Vollansicht öffnen" in the menu. */
		open: (ticketId: string) => { panel: ResolvedPathname; full: ResolvedPathname };
		/** The menu "•••" of a ticket; without it the entry has none. */
		rowActions?: TicketRowActionsStore | null;
		/** "Duplizieren …" in that menu (ADR-0045). */
		duplicates?: boolean;
		/** A stop of Tab; false in the cells of the grid. */
		tabbable?: boolean;
		look?: EntryLook;
		/** The ticket, rule or entry is open in the panel next to the calendar. */
		active?: boolean;
		/** The due date as text (the group "Überfällig" of the agenda). */
		dueLabel?: boolean;
		/** Starts moving the due date of the ticket; null: it cannot move here. */
		move?: (() => void) | null;
		/** The due date of this ticket is moving. */
		moving?: boolean;
		/** Its new due date is being saved. */
		pending?: boolean;
	} = $props();

	/** Titles from this length name themselves on hover; one line may cut them. */
	const LONG_TITLE = 40;
	const tabindex = $derived(tabbable ? undefined : -1);
	/** "Folge-Ticket anlegen …" in the menu (ADR-0067), with the store of the (app) layout. */
	const followUps = findTicketFollowUpStore();

	const project = $derived.by((): ProjectRef | null => {
		if (entry.kind === 'ticket') return projectOf(entry.ticket.projectId) ?? entry.ticket.project;
		if (entry.kind === 'planned') return projectOf(entry.planned.projectId);
		return null;
	});
	const color = $derived.by((): ShownColor | null => {
		if (entry.kind === 'ticket') return ticketColorOf(entry.ticket, project);
		if (entry.kind === 'planned') return ticketColorOf({ color: entry.planned.color }, project);
		return null;
	});
	/** The charm of a ticket, of a planned date the one of its template (ADR-0062). */
	const charm = $derived(
		charmOf(
			entry.kind === 'ticket'
				? entry.ticket.charm
				: entry.kind === 'planned'
					? entry.planned.charm
					: null
		)
	);
	const title = $derived(
		entry.kind === 'ticket'
			? entry.ticket.title
			: entry.kind === 'planned'
				? entry.planned.title
				: entry.item.title
	);
	const appears = $derived(
		entry.kind === 'planned' ? plannedAppearsText(entry.planned, today) : ''
	);
	const due = $derived(
		entry.kind === 'ticket' && dueLabel ? relativeDue(entry.ticket.due, today).text : ''
	);
	/** Project, color and charm for screen readers, after the visible text of the link. */
	const details = $derived(
		[
			project === null ? '' : `Projekt ${projectPath(project)}`,
			color === null ? '' : colorText(color),
			charm === null ? '' : charmText(charm)
		]
			.filter((part) => part !== '')
			.join(', ')
	);
</script>

{#snippet mark()}
	{#if color}
		<ColorMark shown={color} kind={look === 'dot' ? 'dot' : 'stripe'} named={false} />
	{:else if look === 'dot'}
		<span class="plain-dot" aria-hidden="true"></span>
	{/if}
{/snippet}

<!-- The charm before the title (ADR-0062); a narrow month shows only dots, the link names it. -->
{#snippet charmMark()}
	{#if charm !== null && look !== 'dot'}
		<CharmIcon charm={charm.key} named={false} />
	{/if}
{/snippet}

{#if entry.kind === 'ticket'}
	{@const ticket = entry.ticket}
	<li
		class="entry ticket {look}"
		class:done={entry.done}
		class:overdue={entry.overdue}
		class:active
		class:moving
		class:pending
		data-menu-row={rowActions ? '' : undefined}
		aria-busy={pending ? 'true' : undefined}
	>
		<a
			class="link"
			href={href(ticket.id)}
			{tabindex}
			data-row-link
			data-calendar-ticket={ticket.id}
			data-movable={move === null ? undefined : ''}
			draggable={move === null ? undefined : 'false'}
			aria-keyshortcuts={move === null ? undefined : CALENDAR_MOVE_KEY.toUpperCase()}
			aria-current={active ? 'true' : undefined}
			title={look === 'dot' || title.length >= LONG_TITLE ? `${ticket.key} ${title}` : undefined}
		>
			{@render mark()}
			{#if entry.done}
				<svg class="state" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M3.5 8.5l3 3 6-7" />
				</svg>
			{:else if entry.overdue}
				<svg class="state" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<circle cx="8" cy="8" r="6.25" />
					<path d="M8 4.75V8.5l2.25 1.5" />
				</svg>
			{/if}
			{@render charmMark()}
			<span class="text">
				<span class="key" class:visually-hidden={look === 'line' || look === 'dot'}
					>{ticket.key}</span
				>
				<span class="title" class:visually-hidden={look === 'dot'}>{title}</span>
			</span>
			<span class="visually-hidden"
				>{entry.done ? ', erledigt' : ''}{entry.overdue ? ', überfällig' : ''}{details === ''
					? ''
					: `, ${details}`}</span
			>
		</a>
		{#if look === 'row'}
			<span class="extras">
				{#if due !== ''}<span class="due">{due}</span>{/if}
				{#if project !== null}<span class="project">{projectPath(project)}</span>{/if}
				<span class="visually-hidden">Status:&nbsp;</span><StatusPill status={ticket.status} />
				<PriorityIcon priority={ticket.priority} />
			</span>
		{/if}
		{#if rowActions}
			{@const actions = rowActions}
			<span class="menu" aria-busy={actions.isPreparing(ticket.id) ? 'true' : undefined}>
				<TicketActions
					{ticket}
					flags={actions.flags}
					open={open(ticket.id)}
					buttonLabel={`Weitere Aktionen für ${ticket.key}`}
					buttonClass="button-icon row-menu"
					buttonTabindex={tabbable ? undefined : -1}
					onmovedue={move}
					onduplicate={duplicates ? () => void actions.choose('duplicate', ticket) : null}
					onfollowup={followUps !== null ? () => void actions.choose('followup', ticket) : null}
					ondelete={() => void actions.choose('delete', ticket)}
				/>
			</span>
		{/if}
	</li>
{:else if entry.kind === 'planned'}
	<li class="entry planned {look}" class:active>
		<a
			class="link"
			href={ruleHref(entry.planned.ruleId)}
			{tabindex}
			data-calendar-rule={entry.planned.ruleId}
			aria-current={active ? 'true' : undefined}
			title={`Geplant: ${title}, ${appears}`}
		>
			{@render mark()}
			<svg class="state" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1" />
				<path d="M3.25 1.75v3h3M12.75 14.25v-3h-3" />
			</svg>
			{@render charmMark()}
			<span class="text">
				<span class="visually-hidden">Geplant: </span>
				<span class="title" class:visually-hidden={look === 'dot'}>{title}</span>
				<span class="note" class:visually-hidden={look === 'dot' || look === 'line'}
					>, {appears}</span
				>
			</span>
			{#if details !== ''}<span class="visually-hidden">, {details}</span>{/if}
		</a>
		{#if look === 'row'}
			<span class="extras">
				{#if project !== null}<span class="project">{projectPath(project)}</span>{/if}
				<span class="start">startet {STATUS_LABELS[entry.planned.status]}</span>
				<PriorityIcon priority={entry.planned.priority} />
			</span>
		{/if}
	</li>
{:else}
	{@const item = entry.item}
	<li class="entry inbox {look}" class:active>
		<a
			class="link"
			href={itemHref(item.id)}
			{tabindex}
			data-calendar-item={item.id}
			aria-current={active ? 'true' : undefined}
			title={`Termin im Eingang: ${title} (${CHANNEL_LABELS[item.channel]})`}
		>
			{@render mark()}
			<svg class="state" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M2.5 9.5l1.75-6h7.5l1.75 6v3.5h-11zM2.5 9.5h3l1 1.5h3l1-1.5h3" />
			</svg>
			<span class="text">
				<span class="visually-hidden">Termin im Eingang: </span>
				<span class="title" class:visually-hidden={look === 'dot'}>{title}</span>
			</span>
			<span class="visually-hidden">, {CHANNEL_LABELS[item.channel]}</span>
		</a>
		{#if look === 'row'}
			<span class="extras"><span class="project">{CHANNEL_LABELS[item.channel]}</span></span>
		{/if}
	</li>
{/if}

<style>
	.entry {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
		border-radius: var(--radius-item);
	}

	.entry.active {
		background: var(--color-brand-soft-bg);
	}

	.link {
		display: flex;
		flex: 1 1 auto;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
		padding: 0.0625rem 0.25rem;
		font-size: var(--font-size-small);
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-item);
	}

	.link:hover {
		background: var(--fill-control-hover);
	}

	/* The charm keeps the gap it has everywhere (0.375rem, ADR-0062): the link adds 0.25rem. */
	.link :global(.charm-mark) {
		margin-right: 0.125rem;
	}

	.entry.active .link {
		color: var(--color-brand-soft-text);
	}

	/* The stripe of the color (ColorMark) as high as the line. */
	.link :global(.color-mark.stripe) {
		align-self: stretch;
		min-height: 0.875rem;
	}

	.text {
		display: flex;
		gap: 0.25rem;
		align-items: baseline;
		min-width: 0;
	}

	.key {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--font-size-caption);
		color: var(--color-text-muted);
	}

	.title {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* Week and agenda: key above or before the title, the title on two lines at most. */
	.block .text {
		flex-direction: column;
		gap: 0;
		align-items: flex-start;
	}

	/*
	 * A long key ("ABCDEF-1000000") in a narrow day of the week wraps inside the day instead of
	 * running into the next one; it is never cut off (KN-1).
	 */
	.block .key {
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.block .title,
	.row .title {
		display: -webkit-box;
		white-space: normal;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.row .link {
		font-size: var(--font-size-body);
	}

	.state {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Overdue: bold in the color of the text, with the clock (ADR-0009: never red). */
	.overdue .link {
		font-weight: 600;
	}

	/* The ticket whose due date moves: dashed frame on the accent surface, not color alone. */
	.moving .link {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		outline: 2px dashed var(--color-brand-text);
		outline-offset: -2px;
	}

	/* Its new due date is being saved: muted, the busy pointer only with aria-busy (ADR-0026). */
	.pending .link {
		color: var(--color-text-muted);
	}

	.entry[aria-busy='true'] .link {
		cursor: progress;
	}

	/* Done: muted, with the check mark; the stripe keeps its full color (3 : 1, ADR-0052). */
	.done .link {
		color: var(--color-text-muted);
	}

	/* Planned: pale and dashed. */
	.planned .link {
		color: var(--color-text-muted);
		border: 1px dashed var(--color-line);
	}

	.note {
		color: var(--color-text-muted);
	}

	.inbox .link {
		color: var(--color-text-muted);
	}

	.plain-dot {
		flex: none;
		width: 0.625rem;
		height: 0.625rem;
		border: 1px solid var(--color-text-muted);
		border-radius: 50%;
	}

	.planned .plain-dot {
		border-style: dashed;
	}

	/* A narrow month: a row of marks, each one a link with its full name. */
	.dot {
		display: inline-flex;
	}

	.dot .link {
		padding: 0.125rem;
	}

	.dot .state {
		display: none;
	}

	/*
	 * A line of a month has no room for "•••": its menu opens with a right click, Shift+F10 or the
	 * context menu key (rowMenus finds the hidden button), and in the list of the day and the week.
	 */
	.dot .menu,
	.line .menu {
		display: none;
	}

	.extras {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		max-width: 100%;
		margin-left: auto;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.due {
		font-weight: 600;
		color: var(--color-text);
	}

	.project {
		overflow-wrap: anywhere;
	}

	.row {
		flex-wrap: wrap;
		padding: 0.25rem 0;
		border-top: 1px solid var(--color-line);
	}

	/* The menu "•••" of a week shows on pointing and with the focus; always where nothing hovers. */
	.block .menu {
		opacity: 0;
	}

	.entry:hover .menu,
	.entry:focus-within .menu {
		opacity: 1;
	}

	@media (hover: none) {
		.block .menu {
			opacity: 1;
		}
	}
</style>
