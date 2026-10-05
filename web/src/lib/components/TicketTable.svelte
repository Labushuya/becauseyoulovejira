<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { projectColorOf, type ShownColor } from '$lib/domain/colors';
	import { NEST_SUBTASKS, TICKET_TABLE, withKeyDefaults } from '$lib/domain/columns';
	import { arrangeRows } from '$lib/domain/subtasks';
	import {
		GROUPING_LABELS,
		readCollapsedGroups,
		writeCollapsedGroups,
		type GroupNode
	} from '$lib/domain/grouping';
	import { NO_PROJECT } from '$lib/domain/list-query';
	import {
		MORE_COLUMNS_HINT,
		SORT_COLUMN_LABELS,
		sortLabel,
		sortOrderLabel
	} from '$lib/domain/labels';
	import {
		hasDetailFilters,
		hasFilters,
		parseListQuery,
		resetFilters
	} from '$lib/domain/list-query';
	import { nextSort, sortDirection, type SortKey } from '$lib/domain/ordering';
	import {
		PINNED_SECTION,
		pinnedCountText,
		pinnedMoreText,
		readPinnedFolded,
		writePinnedFolded
	} from '$lib/domain/pins';
	import { parentOf } from '$lib/domain/subtasks';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { findAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
	import { findPinStore, type PinStore } from '$lib/stores/pins.svelte';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import {
		findTicketFollowUpStore,
		type TicketFollowUpStore
	} from '$lib/stores/ticket-follow-up.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import {
		NEW_TICKET_LINK_ID,
		doneOfListHref,
		fullViewHref,
		listHref,
		newTicketHref,
		ticketHref,
		withListQuery
	} from '$lib/ticket-links';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { getQuickCaptureOpener } from '$lib/quick-capture-context';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import {
		EMPTY_SELECTION,
		clickRow,
		headState,
		keepShown,
		toggleAll,
		type Selection
	} from '$lib/domain/selection';
	import type { BulkEditStore } from '$lib/stores/bulk-edit.svelte';
	import BulkActionBar from './BulkActionBar.svelte';
	import ColorMark from './ColorMark.svelte';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import CompletionDialog from './CompletionDialog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import FilterSummary from './FilterSummary.svelte';
	import GroupPopover from './GroupPopover.svelte';
	import PinIcon from './PinIcon.svelte';
	import SectionBar from './SectionBar.svelte';
	import { CELL_PADDING_REM, CHIP_GAP_REM, createChipMeasure, remPx } from './table/chip-measure';
	import { ColumnFit, cellsOf } from './table/column-fit.svelte';
	import { naturalWidth } from './table/measure';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import TicketActions from './TicketActions.svelte';
	import TicketPinToggle from './TicketPinToggle.svelte';
	import TicketRowDialogs from './TicketRowDialogs.svelte';
	import TicketTableRow from './TicketTableRow.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Ticket table (E3 plan, T-4 and packages 5, 9, 10, 13 and 14; E2 plan, P-1 to P-5): section
	// bar "Aufgaben" with the number of shown tickets, the navigation of the views, the link
	// "Erledigte ansehen →" and the popover "Gruppieren"; the open tickets that pass the filters (the
	// store holds the query of the URL) in the column sort of the URL or the default order, with a
	// grouping in one tbody per group. Since ER-1 (ADR-0066) the table shows only open work: done
	// tickets have the view "Erledigte", which the link opens with the filters both views know
	// (project, tag, search). Sort buttons sit in the column headers (T-5). Project and tags come from the
	// catalog. The table never scrolls sideways (package UI-6b): fitColumns (ADR-0030) fits the
	// columns into the measured frame with the widths of the user; when the frame gets narrow (next
	// to the panel, on a small window) columns give way in a fixed order, first "Erstellt", then
	// "Tags", then "Projekt", last "Fällig"; key, title and the check mark always stay. The caption
	// then names the panel, where the hidden values stand. A grip on the right edge of a header
	// changes the width of its column (package SP-2).
	// Groups on two levels (plan OR-3, ADR-0013 addendum B): a first level has a tbody with its
	// head only, each group of the second level a tbody of its own, named by both heads. Every
	// head is a disclosure button (aria-expanded) with the label and the number of open tickets;
	// folded groups are kept per tab in sessionStorage. Sub-tasks follow their parent only within
	// the same leaf group (arrangeRows per leaf, ADR-0033 section 5).
	// Selection (plan BI-2, ADR-0036 §2): a fixed first column with a checkbox per row, apart from
	// the check mark "erledigt" at the end. Shift+click chooses a range in the order of the rows,
	// the head checkbox all rows that pass the filters (also in folded groups), indeterminate when
	// only some are chosen. A filter change keeps only rows that are still shown; Escape in the
	// table clears the selection. With `bulk` the bar of the bulk actions stands above the table.
	// Menu of a row (plan aktionsmenues, AM-2): with `rowActions` every row ends with "•••" after
	// "Öffnen": the ticket in the panel or the full view (links, whatever way is remembered, which
	// they do not change), "Link kopieren", "Duplizieren …" (with `duplicates`), "Folge-Ticket
	// anlegen …" (with `followUps`, ADR-0067) and "In den Papierkorb …". The table is no modal, so their questions open as the dialogs of the panel;
	// a click on "•••" or in the menu never opens the row. A ticket moved to the trash while its
	// panel is open closes the panel. A right click on a row, Shift+F10 or the context menu key
	// open the same menu at the pointer or the focused element (AM-3, rowMenus); the browser keeps
	// its menu in fields, on selected text, on other links, with Ctrl and for touch.
	// Filter cards (FI-1, ADR-0013 addendum C): while a card is chosen, a summary above the table
	// names the cards the shown tickets come from, with the matching pinned tickets like the number
	// of the heading ("4 + 1 angeheftet aus: Dringend", PL-1); its "Zurücksetzen" works like "Filter
	// zurücksetzen" of the empty result and moves the focus to "Aufgaben".
	// Pinned tickets (ADR-0064): the first tbody is the section "Angeheftet" with the open pinned
	// tickets of the area in the order of pinning, whatever the filters, the search and the sort; they
	// do not stand again below, and the number of the heading says "+ N angeheftet". Its head folds
	// like a group, kept on this device. Every row has the pin toggle at the end of its title.
	let {
		store,
		catalog,
		activeId = null,
		creating = false,
		inboxCount = null,
		recurrenceTextOf = () => '',
		bulk,
		rowActions,
		duplicates = null,
		followUps = findTicketFollowUpStore(),
		pins = findPinStore(),
		assignees = findAssignees(),
		tools,
		emptyExtra
	}: {
		store: TicketListStore;
		catalog: CatalogStore;
		/** Ticket shown in the detail panel; its row is marked as current. */
		activeId?: string | null;
		/** The form "Neues Ticket" is open. */
		creating?: boolean;
		/** New inbox entries for the switch (E4 plan, package 3). */
		inboxCount?: number | null;
		/** Rhythm of the series of a ticket in words, '' while unknown (E5 plan, package 4). */
		recurrenceTextOf?: (ticket: TicketSummary) => string;
		/** Bulk actions on the chosen rows (plan BI-2); without it the bar is not shown. */
		bulk?: BulkEditStore;
		/** The menu "•••" of every row (plan aktionsmenues, AM-2); without it the rows have none. */
		rowActions?: TicketRowActionsStore;
		/** "Duplizieren …" in the menu of a row (ADR-0045); null leaves the entry out. */
		duplicates?: TicketDuplicateStore | null;
		/** "Folge-Ticket anlegen …" in the menu of a row (ADR-0067); null leaves the entry out. */
		followUps?: TicketFollowUpStore | null;
		/** The own pins (ADR-0064) for the toggle of a row; null: no toggle (the section follows the store). */
		pins?: PinStore | null;
		/**
		 * "Zuständig" (ADR-0068): in a household the initials at the title or the column with the
		 * assignee; null or outside a household neither.
		 */
		assignees?: AssigneeSource | null;
		/**
		 * Filter cards and filter bar, below the section bar: the switch "Aufgaben | Projekte |
		 * Eingang" stands at the same place in every view (ADR-0025 section 10, package UI-8).
		 */
		tools?: Snippet;
		/** Below the empty state "Keine offenen Tickets", e.g. "Erste Schritte" (plan EH-12). */
		emptyExtra?: Snippet;
	} = $props();

	const uid = $props.id();
	// Rows open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();
	const ids = {
		heading: `${uid}-heading`,
		caption: `${uid}-caption`,
		pinned: `${uid}-pinned`
	};
	const query = $derived(store.query);
	const filtered = $derived(hasFilters(query));
	const hasOpenRows = $derived(store.visible.length > 0);
	/** The section "Angeheftet" (ADR-0064) stands above the list, whatever the filters. */
	const pinnedCount = $derived(store.pinned.length);
	const hasPinnedRows = $derived(pinnedCount > 0);
	const countReady = $derived(store.openState === 'ready');
	const countLabel = $derived.by(() => {
		const count = store.visibleCount;
		const pinnedText = hasPinnedRows ? `, ${pinnedMoreText(pinnedCount)}` : '';
		return `${count === 1 ? '1 Ticket' : `${count} Tickets`}${pinnedText}`;
	});
	const countText = $derived(
		`${store.visibleCount}${hasPinnedRows ? ` ${pinnedMoreText(pinnedCount)}` : ''}`
	);
	/** "Erledigte ansehen →": the view "Erledigte" with the filters both views know (ADR-0066). */
	const doneLink = $derived(doneOfListHref(page.url));

	/** Quick entry of the (app) layout for the empty state; undefined outside it (plan EH-11). */
	const openQuickCapture = getQuickCaptureOpener();

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	/** Pixels of 1rem on this page, for the widths measured in the rows. */
	const rem = remPx();
	/** The tickets the table shows: the pinned and the open ones (done ones in "Erledigte", ADR-0066). */
	const shownTickets = $derived([...store.pinned, ...store.visible]);

	// Columns (ADR-0030): the preferences of this device and the measured frame decide which
	// columns are shown and how wide they are. Key and "Übergeordnet" take the longest key of the
	// shown tickets as their default, Key with room for the dot "neu" (KN-1, Nachtrag 7).
	// The column "Zuständig" exists only in a household (ADR-0068).
	const assigneesShown = $derived(assignees?.active === true);
	const columnFit = new ColumnFit(getColumnPrefs('tickets'), () =>
		withKeyDefaults(
			TICKET_TABLE.columns.filter((column) => column.id !== 'assignee' || assigneesShown),
			[
				{ id: 'key', keys: shownTickets.map((ticket) => ticket.key), dot: true },
				{
					id: 'parent',
					keys: shownTickets.flatMap(
						(ticket) => parentOf(ticket, (id) => store.find(id))?.key ?? []
					)
				}
			],
			rem
		)
	);
	const fit = $derived(columnFit.fit);
	const shown = $derived(columnFit.shown);
	// Sub-tasks directly below their parent (ADR-0033 section 5), a switch of the menu "Spalten".
	const nest = $derived(columnFit.store.option(NEST_SUBTASKS));
	let frame = $state<HTMLElement>();

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

	// Compact tags (SP-4): one measure with its cache for all rows, and the room for the chips.
	const measureChip = createChipMeasure();
	const tagsSpace = $derived(columnFit.widthOf('tags') - CELL_PADDING_REM * rem);

	/** All chips of the widest row side by side, plus the padding of the cell. */
	function tagsNaturalWidth(): number {
		const tickets = shownTickets;
		const gap = CHIP_GAP_REM * rem;
		const widest = Math.max(
			0,
			...tickets.map((ticket) => {
				const names = catalog.tagsOf(ticket).map((tag) => tag.name);
				const line = names.reduce((total, name) => total + measureChip(name), 0);
				return line + gap * Math.max(0, names.length - 1);
			})
		);
		return Math.ceil(widest + CELL_PADDING_REM * rem);
	}

	/** Double click on the grip of "Tags": all chips, since a row renders only those that fit. */
	function autofitTags() {
		if (!frame) return;
		const head = cellsOf(frame, 'tags').filter((cell) => cell.tagName === 'TH');
		columnFit.autofit('tags', Math.max(tagsNaturalWidth(), naturalWidth(head)));
	}

	function sessionStore(): Storage | null {
		try {
			return window.sessionStorage;
		} catch {
			return null;
		}
	}

	/** Folded groups of this tab by their path (plan OR-3); default open. */
	const collapsed = new SvelteSet<string>(readCollapsedGroups(sessionStore()));

	/** Folds or unfolds a group; the button keeps the focus. */
	function toggleGroup(path: string) {
		if (collapsed.has(path)) collapsed.delete(path);
		else collapsed.add(path);
		writeCollapsedGroups(sessionStore(), [...collapsed]);
	}

	function deviceStore(): Storage | null {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	}

	/** The section "Angeheftet" folded on this device (ADR-0064); default open. */
	let pinnedFolded = $state(readPinnedFolded(deviceStore()));

	/** Folds or unfolds the section "Angeheftet"; the button keeps the focus. */
	function togglePinned() {
		pinnedFolded = !pinnedFolded;
		writePinnedFolded(deviceStore(), pinnedFolded);
	}

	/**
	 * After pinning or releasing, the row stands in its other section: the focus follows it to its
	 * toggle (a folded section keeps it where restoreFocus put it).
	 */
	async function focusPinToggle(ticketId: string) {
		await tick();
		const toggle = [...(root?.querySelectorAll<HTMLElement>('[data-pin-toggle]') ?? [])].find(
			(element) => element.dataset.pinToggle === ticketId
		);
		toggle?.focus();
	}

	/** Open tickets of a group (a just checked row still stands in it but does not count). */
	function openCount(group: GroupNode<TicketSummary>): number {
		return group.tickets.filter((ticket) => ticket.status !== 'done').length;
	}

	/**
	 * Color of a group "Nach Projekt" (ADR-0052): the one of its project, else of the parent; the
	 * label of the group names the project, so the dot needs no text of its own.
	 */
	function groupColorOf(group: GroupNode<TicketSummary>, level: 1 | 2): ShownColor | null {
		const grouping = level === 1 ? query.grouping : query.subGrouping;
		if (grouping !== 'project' || group.key === NO_PROJECT) return null;
		return projectColorOf(catalog.projectById(group.key));
	}

	/** Row that last had the focus, to restore it when that row moves or disappears. */
	let lastFocus: { id: string; section: string; index: number } | null = null;

	/** "Filter zurücksetzen" of the empty result; the focus goes to the heading "Aufgaben". */
	async function clearFilters() {
		await goto(withListQuery(page.url, resetFilters(query)), { keepFocus: true, noScroll: true });
		heading?.focus();
	}

	/**
	 * Click cycle of a column header (T-5): natural direction, reversed, default order. It is a
	 * navigation with a history entry, so back restores the previous sort; the focus stays on the
	 * button.
	 */
	async function sortBy(key: SortKey) {
		const current = parseListQuery(page.url.searchParams);
		await goto(withListQuery(page.url, { ...current, sort: nextSort(current.sort, key) }), {
			keepFocus: true,
			noScroll: true
		});
	}

	function rowsOf(section: string): HTMLElement[] {
		return [
			...(root?.querySelectorAll<HTMLElement>(
				`tbody[data-section="${section}"] > tr[data-ticket-id]`
			) ?? [])
		];
	}

	function rowOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('tr[data-ticket-id]') ?? [])].find(
			(row) => row.dataset.ticketId === id
		);
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function onfocusin(event: FocusEvent) {
		const row = event.target instanceof Element ? event.target.closest('tr[data-ticket-id]') : null;
		if (!(row instanceof HTMLElement)) return;
		const section = row.parentElement?.dataset.section;
		const id = row.dataset.ticketId;
		if (!section || !id) return;
		lastFocus = { id, section, index: rowsOf(section).indexOf(row) };
	}

	function onfocusout(event: FocusEvent) {
		// Focus moved elsewhere on purpose; a removed element reports no related target.
		if (event.relatedTarget instanceof Node && !root?.contains(event.relatedTarget)) {
			lastFocus = null;
		}
	}

	/**
	 * Keyboard focus after rows moved or vanished (checked, unchecked, "Rückgängig" in the flag):
	 * back to the check mark of the same ticket, else to the row now at the same place, else to the
	 * heading. It never goes to the flag (ADR-0025 section 8).
	 */
	function restoreFocus() {
		if (lastFocus === null || !focusLost()) return;
		const { id, section, index } = lastFocus;
		const moved = rowOf(id)?.querySelector<HTMLElement>('[data-col="actions"] input');
		const rows = rowsOf(section);
		const neighbour =
			rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>('a.title-link');
		(moved ?? neighbour ?? heading)?.focus();
	}

	$effect(() => {
		// Re-run whenever the rendered rows change.
		void store.pinned;
		void store.visible;
		void store.groups;
		restoreFocus();
	});

	/** Chosen rows for the bulk actions (plan BI-2). */
	let selection = $state<Selection>(EMPTY_SELECTION);
	/** Rows a selection may hold: every ticket that passes the filters and the pinned ones above. */
	const selectable = $derived([...store.pinned, ...store.visible].map((ticket) => ticket.id));
	/**
	 * Rows of the head checkbox: every ticket that passes the filters, as before the pins; a pinned
	 * ticket the filters hide is chosen only by its own box.
	 */
	const filteredIds = $derived(
		[...store.pinnedInFilter, ...store.visible].map((ticket) => ticket.id)
	);
	const head = $derived(headState(selection, filteredIds));
	const chosenTickets = $derived(
		selection.ids.flatMap((id) => {
			const ticket = store.find(id);
			return ticket === null ? [] : [ticket];
		})
	);
	let headBox = $state<HTMLInputElement>();
	const selectColumn = TICKET_TABLE.columns.find((column) => column.id === 'select');

	// A filter change, a new sort or rows that left the list: only shown rows stay chosen.
	$effect(() => {
		const next = keepShown(selection, selectable);
		if (next !== selection) selection = next;
	});

	$effect(() => {
		if (headBox) headBox.indeterminate = head === 'some';
	});

	/** IDs of the rendered rows in their order on screen, for a Shift range. */
	function rowOrder(): string[] {
		return [...(root?.querySelectorAll<HTMLElement>('tr[data-ticket-id]') ?? [])].flatMap((row) =>
			row.dataset.ticketId ? [row.dataset.ticketId] : []
		);
	}

	function select(id: string, on: boolean, range: boolean) {
		selection = clickRow(selection, id, on, rowOrder(), range);
	}

	function clearSelection() {
		selection = EMPTY_SELECTION;
	}

	/** Escape in the table or the bar clears the selection, unless a field or popover took it. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || selection.ids.length === 0) return;
		const target = event.target;
		const typing =
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio');
		if (typing) return;
		event.preventDefault();
		event.stopPropagation();
		clearSelection();
	}

	/** Ticket whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (button, Escape, browser back) returns the focus to the row of its
	// ticket, or to the heading if the row is gone (E2 plan, section 3).
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(rowOf(previous)?.querySelector<HTMLElement>('a.title-link') ?? heading)?.focus();
		});
	});

	/** "In den Papierkorb …" of a row; the panel of that ticket closes afterwards. */
	async function moveRowToTrash(ticketId: string, sources?: DeleteSources): Promise<DeleteResult> {
		if (!rowActions) return { ok: false, message: null };
		const result = await rowActions.deleteTicket(sources);
		if (result.ok && ticketId === activeId) await goto(listHref(page.url));
		return result;
	}

	/** Whether the form "Neues Ticket" was open. */
	let wasCreating = false;

	// Leaving the form without a new ticket returns the focus to "Neues Ticket" in the header.
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (document.getElementById(NEW_TICKET_LINK_ID) ?? heading)?.focus();
		});
	});
</script>

<!-- One section (a group, the open or the done tickets): sub-tasks follow their parent only when
     both are in it (ADR-0033 section 5); the pinned tickets keep the order of pinning. -->
{#snippet rows(tickets: readonly TicketSummary[], nestRows: boolean = nest)}
	{#each arrangeRows(tickets, nestRows, (id) => store.find(id)) as row (row.ticket.id)}
		{@const ticket = row.ticket}
		<TicketTableRow
			{ticket}
			nested={row.nested}
			parent={row.parent}
			progress={store.progressOf(ticket.id)}
			project={catalog.projectOf(ticket)}
			tags={catalog.tagsOf(ticket)}
			href={links.href(ticket.id, page.url)}
			today={store.today}
			checked={store.isChecked(ticket)}
			pending={store.isPending(ticket.id)}
			active={ticket.id === activeId}
			isNew={store.isNew(ticket)}
			recurrenceText={ticket.recurring ? recurrenceTextOf(ticket) : ''}
			columns={shown}
			columnWidths={fit.widths}
			{rem}
			{tagsSpace}
			measure={measureChip}
			selected={selection.ids.includes(ticket.id)}
			onselect={(on, range) => select(ticket.id, on, range)}
			edit={{
				projects: catalog.activeProjects,
				tags: catalog.tags,
				busy: store.isPending(ticket.id),
				save: (patch) => store.changeField(ticket.id, patch),
				createTag: (name) => catalog.ensureTag(name)
			}}
			assignees={assigneesShown ? assignees : null}
			menu={rowActions ? rowMenu : undefined}
			menuBusy={rowActions?.isPreparing(ticket.id) ?? false}
			pin={pins?.available && (ticket.status !== 'done' || pins.isPinned(ticket.id))
				? pinToggle
				: undefined}
			ontoggle={(done) => store.setDone(ticket.id, done)}
		/>
	{/each}
{/snippet}

<!-- The pin toggle of a row (ADR-0064). -->
{#snippet pinToggle(ticket: TicketSummary)}
	<TicketPinToggle {ticket} {pins} onchanged={(id) => void focusPinToggle(id)} />
{/snippet}

<!-- The menu "•••" of a row (plan aktionsmenues, AM-2). -->
{#snippet rowMenu(ticket: TicketSummary)}
	<TicketActions
		{ticket}
		flags={rowActions?.flags ?? SILENT_FLAGS}
		open={{ panel: ticketHref(ticket.id, page.url), full: fullViewHref(ticket.id, page.url) }}
		buttonLabel={`Weitere Aktionen für ${ticket.key}`}
		buttonClass="button-icon row-menu"
		onduplicate={duplicates === null ? null : () => void rowActions?.choose('duplicate', ticket)}
		onfollowup={followUps === null ? null : () => void rowActions?.choose('followup', ticket)}
		ondelete={() => void rowActions?.choose('delete', ticket)}
	/>
{/snippet}

<!-- Head of a group: a disclosure button with the label and the number (plan OR-3). -->
{#snippet groupHead(group: GroupNode<TicketSummary>, id: string, level: 1 | 2)}
	{@const count = openCount(group)}
	{@const folded = collapsed.has(group.path)}
	{@const color = groupColorOf(group, level)}
	<tr class="section-head group-head" class:level-2={level === 2}>
		<th scope="rowgroup" colspan={fit.visible.length} {id}>
			<button
				class="group-toggle"
				type="button"
				aria-expanded={!folded}
				title={folded ? 'Gruppe aufklappen' : 'Gruppe zuklappen'}
				onclick={() => toggleGroup(group.path)}
			>
				<svg class="fold" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
					<path d={folded ? 'M4.5 3l3 3-3 3' : 'M3 4.5l3 3 3-3'} />
				</svg>
				{#if color}<ColorMark shown={color} named={false} />{/if}
				{group.label}<span class="group-count"
					><span aria-hidden="true">{count}</span><span class="visually-hidden"
						>, {count === 1 ? '1 Ticket' : `${count} Tickets`}</span
					></span
				>
			</button>
		</th>
	</tr>
{/snippet}

<!-- Header of a shown column; `key` makes it a sort button (T-5), the grip resizes (SP-2). -->
{#snippet header(id: string, text: string, key: SortKey | null = null)}
	{@const column = TICKET_TABLE.columns.find((entry) => entry.id === id)}
	{@const sorted = key !== null && query.sort?.key === key ? query.sort : null}
	{@const direction = sorted === null ? null : sortDirection(sorted)}
	{#if column && shown.has(id)}
		<ResizableHeader
			{column}
			fit={columnFit}
			ariaSort={direction ?? undefined}
			onautofit={id === 'tags' ? autofitTags : undefined}
		>
			{#if key !== null}
				<button
					class="sort"
					class:sorted={sorted !== null}
					type="button"
					onclick={() => sortBy(key)}
				>
					<span aria-hidden="true">{text}</span>
					<span class="visually-hidden">
						Nach {SORT_COLUMN_LABELS[key]} sortieren{sorted === null
							? ''
							: `, sortiert: ${sortOrderLabel(sorted)}`}
					</span>
					<svg
						class="sort-icon"
						data-direction={direction ?? 'none'}
						viewBox="0 0 12 12"
						aria-hidden="true"
						focusable="false"
					>
						{#if direction === 'ascending'}
							<path d="M6 2.5v7M3 5.5l3-3 3 3" />
						{:else if direction === 'descending'}
							<path d="M6 2.5v7M3 6.5l3 3 3-3" />
						{:else}
							<path d="M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5" />
						{/if}
					</svg>
				</button>
			{:else if id === 'actions'}
				<span class="visually-hidden">{text}</span>
			{:else}
				{text}
			{/if}
		</ResizableHeader>
	{/if}
{/snippet}

{#snippet failure(message: string, retryLabel: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="button-secondary button-small" type="button" onclick={onretry}
			>{retryLabel}</button
		>
	</div>
{/snippet}

<!-- Escape clears the selection from anywhere in the table (plan BI-2). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="ticket-table"
	aria-labelledby={ids.heading}
	bind:this={root}
	{onfocusin}
	{onfocusout}
	{onkeydown}
>
	<SectionBar
		title="Aufgaben"
		headingId={ids.heading}
		count={countReady ? countText : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="tasks" {inboxCount} projectsNewCount={store.newInProjects} />
		{/snippet}
		{#snippet end()}
			{#if store.newCount > 0}
				<button
					class="button-secondary button-small mark-read"
					type="button"
					onclick={() => store.markAllRead()}
				>
					Alle als gelesen markieren<span class="visually-hidden"
						>, {store.newCount === 1 ? '1 neues Ticket' : `${store.newCount} neue Tickets`}</span
					>
				</button>
			{/if}
			<a class="done-link" href={doneLink}>Erledigte ansehen <span aria-hidden="true">→</span></a>
			<GroupPopover />
			<ColumnsPopover
				fit={columnFit}
				always="Auswahl, Key, Titel und das Häkchen sind immer sichtbar."
				omitted={assigneesShown ? [] : ['assignee']}
			/>
		{/snippet}
	</SectionBar>

	{@render tools?.()}

	{#if countReady && query.cards.length > 0}
		<FilterSummary
			cards={query.cards}
			count={store.visibleCount}
			filtered={hasDetailFilters(query)}
			pinned={store.pinnedInFilter.length}
			onreset={clearFilters}
		/>
	{/if}

	<p class="visually-hidden" aria-live="polite">{store.announcement}</p>

	{#if bulk && (chosenTickets.length > 0 || bulk.busy || bulk.result !== null)}
		<BulkActionBar
			tickets={chosenTickets}
			store={bulk}
			{catalog}
			openBlockingOf={(id) => store.openBlockingOf(id)}
			onclear={clearSelection}
		/>
	{/if}

	{#if store.openState === 'error' && store.openError}
		{@render failure(store.openError, 'Erneut versuchen', () => store.reload())}
	{:else if store.openState === 'ready' && !hasOpenRows && !hasPinnedRows}
		{#if filtered}
			<EmptyState
				icon="search"
				title="Keine Tickets für diese Filter"
				description="Ändere die Filter oder setze sie zurück, um wieder alle Tickets zu sehen."
			>
				{#snippet primary()}
					<button class="button-primary" type="button" onclick={clearFilters}>
						Filter zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState
				icon="tickets"
				title="Keine offenen Tickets"
				description="Lege ein Ticket an oder erfasse eine Zeile mit der Kurzsyntax."
			>
				{#snippet primary()}
					<a class="button-primary" href={newTicketHref(page.url)}>Ticket anlegen</a>
				{/snippet}
				{#snippet secondary()}
					{#if openQuickCapture}
						<button class="button-subtle" type="button" onclick={openQuickCapture}>
							Schnellerfassung <kbd>c</kbd>
						</button>
					{/if}
				{/snippet}
			</EmptyState>
			{@render emptyExtra?.()}
		{/if}
	{:else if store.openState === 'loading' && !hasOpenRows}
		<p class="loading" role="status">Tickets werden geladen …</p>
	{/if}

	{#if hasOpenRows || hasPinnedRows}
		<div class="frame" bind:this={frame}>
			<table {@attach rowMenus}>
				<caption id={ids.caption}>
					Tickets<span class="caption-order">
						· {query.sort === null
							? 'Standard-Reihenfolge'
							: `sortiert nach ${sortLabel(query.sort)}`}{query.grouping === null
							? ''
							: ` · gruppiert nach ${GROUPING_LABELS[query.grouping]}${
									query.subGrouping === null
										? ''
										: `, dann nach ${GROUPING_LABELS[query.subGrouping]}`
								}`}
					</span>{#if fit.autoHidden.length > 0}<span class="caption-more">{MORE_COLUMNS_HINT}</span
						>{/if}
				</caption>
				<colgroup>
					{#each columnFit.shownColumns as column (column.id)}
						<col
							data-column={column.id}
							style:width={column.flexible ? undefined : `${fit.widths[column.id]}px`}
						/>
					{/each}
				</colgroup>
				<thead>
					<tr>
						{#if selectColumn && shown.has('select')}
							<ResizableHeader column={selectColumn} fit={columnFit} className="select-head">
								<input
									type="checkbox"
									aria-label="Alle angezeigten Tickets auswählen"
									checked={head === 'all'}
									disabled={filteredIds.length === 0}
									bind:this={headBox}
									onchange={() => (selection = toggleAll(selection, filteredIds))}
								/>
							</ResizableHeader>
						{/if}
						{@render header('key', 'Key', 'key')}
						{@render header('priority', 'Prio', 'priority')}
						{@render header('status', 'Status', 'status')}
						{@render header('assignee', 'Zuständig', 'assignee')}
						{@render header('title', 'Titel', 'title')}
						{@render header('parent', 'Übergeordnet')}
						{@render header('source', 'Quelle')}
						{@render header('project', 'Projekt', 'project')}
						{@render header('tags', 'Tags')}
						{@render header('due', 'Fällig', 'due')}
						{@render header('created', 'Erstellt', 'created')}
						{@render header('actions', 'Aktionen')}
					</tr>
				</thead>
				{#if hasPinnedRows}
					<!-- The section "Angeheftet" (ADR-0064): whatever the filters, folded per device. -->
					<tbody data-section="pinned" aria-labelledby={ids.pinned}>
						<tr class="section-head group-head pinned-head">
							<th scope="rowgroup" colspan={fit.visible.length} id={ids.pinned}>
								<button
									class="group-toggle"
									type="button"
									aria-expanded={!pinnedFolded}
									title={pinnedFolded ? 'Abschnitt aufklappen' : 'Abschnitt zuklappen'}
									onclick={togglePinned}
								>
									<svg class="fold" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
										<path d={pinnedFolded ? 'M4.5 3l3 3-3 3' : 'M3 4.5l3 3 3-3'} />
									</svg>
									<PinIcon />
									{PINNED_SECTION}<span class="group-count"
										><span aria-hidden="true">{pinnedCount}</span><span class="visually-hidden"
											>, {pinnedCountText(pinnedCount)}</span
										></span
									>
								</button>
							</th>
						</tr>
						{#if !pinnedFolded}
							{@render rows(store.pinned, false)}
						{/if}
					</tbody>
					{#if !hasOpenRows && store.openState === 'ready'}
						<!-- Everything else the filters let through is pinned, or nothing is. -->
						<tbody data-section="open" aria-label="Offene Tickets">
							<tr class="section-foot">
								<td colspan={fit.visible.length}>
									{#if filtered}
										<p class="muted">Keine weiteren Tickets für diese Filter.</p>
										<button
											class="button-secondary button-small reset"
											type="button"
											onclick={clearFilters}
										>
											Filter zurücksetzen
										</button>
									{:else}
										<p class="muted">Keine weiteren offenen Tickets.</p>
									{/if}
								</td>
							</tr>
						</tbody>
					{/if}
				{/if}
				{#if hasOpenRows && store.groups !== null}
					{#each store.groups as group (group.path)}
						{@const headId = `${uid}-group-${group.key}`}
						{@const folded = collapsed.has(group.path)}
						{#if group.subgroups === null}
							<tbody data-section="open" data-group={group.key} aria-labelledby={headId}>
								{@render groupHead(group, headId, 1)}
								{#if !folded}
									{@render rows(group.tickets)}
								{/if}
							</tbody>
						{:else}
							<tbody
								data-section="open"
								data-group={group.key}
								data-level="1"
								aria-labelledby={headId}
							>
								{@render groupHead(group, headId, 1)}
							</tbody>
							{#if !folded}
								{#each group.subgroups as sub (sub.path)}
									{@const subId = `${uid}-group-${group.key}-${sub.key}`}
									<tbody
										data-section="open"
										data-group={`${group.key}/${sub.key}`}
										data-level="2"
										aria-labelledby={`${headId} ${subId}`}
									>
										{@render groupHead(sub, subId, 2)}
										{#if !collapsed.has(sub.path)}
											{@render rows(sub.tickets)}
										{/if}
									</tbody>
								{/each}
							{/if}
						{/if}
					{/each}
				{:else if hasOpenRows}
					<tbody data-section="open" aria-label="Offene Tickets">
						{@render rows(store.visible)}
					</tbody>
				{/if}
			</table>
		</div>
	{/if}
</section>

<!-- The questions of the menu of a row (plan aktionsmenues, AM-2): the table is no modal, so
     they open as dialogs, and the modal gives the focus back to "•••" (or the heading). -->
{#if rowActions}
	<TicketRowDialogs
		{rowActions}
		{duplicates}
		{followUps}
		projects={catalog.activeProjects}
		subtaskCountOf={(id) => store.progressOf(id).total}
		parentKeyOf={(ticket) => parentOf(ticket, (id) => store.find(id))?.key ?? null}
		onopen={(id) => void goto(links.href(id, page.url))}
		moveToTrash={moveRowToTrash}
	/>
{/if}

<!-- The check mark of a ticket with open blocking sub-tasks asks first (ADR-0033 section 2). -->
{#if store.completion}
	{#key store.completion.id}
		<CompletionDialog
			question={store.completion}
			busy={store.completing}
			error={store.completionError}
			onconfirm={(choice) => void store.confirmCompletion(choice)}
			oncancel={() => store.cancelCompletion()}
		/>
	{/key}
{/if}

<style>
	.ticket-table {
		min-width: 0;
	}

	.mark-read {
		color: var(--color-brand-text);
	}

	/* A quiet link to the view "Erledigte" (ADR-0066 §5); a target of 44 px on touch (ADR-0060 §2). */
	.done-link {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		min-height: var(--control-height-s);
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	@media (pointer: coarse) {
		.done-link {
			min-height: var(--control-height-touch);
		}
	}

	/* The measured frame of fitColumns (ADR-0030); the table takes its width and never more. */
	.frame {
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* Fixed layout: the widths come from the colgroup, the title takes the rest. */
	table {
		width: 100%;
		table-layout: fixed;
		font-size: var(--font-size-body);
		border-collapse: collapse;
	}

	.caption-more {
		font-weight: 400;
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.caption-order {
		font-weight: 400;
	}

	thead :global(th) {
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	/* Head checkbox of the selection (plan BI-2), centred above the boxes of the rows. */
	thead :global(th.select-head) {
		padding: 0.375rem 0;
		text-align: center;
	}

	.sort {
		display: inline-flex;
		max-width: 100%;
		gap: 0.25rem;
		align-items: center;
		padding: 0;
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
	}

	.sort:hover,
	.sort.sorted {
		color: var(--color-text);
	}

	.sort-icon {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.sort-icon[data-direction='none'] {
		opacity: 0.45;
	}

	.sort.sorted .sort-icon {
		color: var(--color-brand-text);
	}

	.section-head th {
		padding: 1rem 0.75rem 0.5rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.group-head th {
		padding-top: 0.75rem;
		color: var(--color-text);
	}

	/* The second level is indented below its first level (plan OR-3). */
	.group-head.level-2 th {
		padding-top: 0.5rem;
		padding-left: 2rem;
		font-weight: 500;
	}

	.group-toggle {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		max-width: 100%;
		padding: 0.125rem 0.25rem;
		margin-left: -0.25rem;
		font: inherit;
		color: inherit;
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.group-toggle:hover {
		background: var(--fill-control-hover);
	}

	.fold {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.group-count {
		display: inline-block;
		min-width: 1.5rem;
		margin-left: 0.5rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.section-foot td {
		padding: 0.5rem 0.75rem;
	}

	.section-foot td:empty {
		padding: 0;
	}

	.reset {
		margin-top: 0.5rem;
	}

	.loading,
	.muted {
		color: var(--color-text-muted);
	}

	.loading {
		padding: 1.5rem 0;
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.failure {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.failure-text {
		flex: 1;
	}
</style>
