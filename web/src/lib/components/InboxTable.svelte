<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { areaMover } from '$lib/area-move-entry';
	import { isCardTap } from '$lib/card-tap';
	import { INBOX_TABLE } from '$lib/domain/columns';
	import { withConnectionName } from '$lib/domain/connections';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import {
		CHANNEL_LABELS,
		KIND_LABELS,
		VIEW_LABELS,
		type InboxItemSummary,
		type InboxView
	} from '$lib/domain/inbox';
	import {
		BULK_LABELS,
		BULK_OFFLINE_HINT,
		BULK_STATES,
		bulkFailureTitle,
		bulkKindOf,
		bulkOfflineText,
		bulkProgressText,
		bulkRunningText,
		bulkSkippedTitle,
		type InboxBulkKind
	} from '$lib/domain/inbox-bulk';
	import { type InboxQuery } from '$lib/domain/inbox-query';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import type { ProblemEntry } from '$lib/domain/problems';
	import type { Project } from '$lib/domain/project';
	import { projectChoiceLabel, treeOrder } from '$lib/domain/project-tree';
	import { SOURCE_FAMILY_CHIPS, SOURCE_FAMILY_LABELS, type SourceFamily } from '$lib/domain/source';
	import { canLeaveTicket, canSavePage, isMainSource } from '$lib/domain/sources';
	import { SYNC_OFFLINE_LABEL } from '$lib/domain/sync-all';
	import {
		NO_TARGET,
		TARGET_LABEL,
		groupByTarget,
		targetOfItem,
		targetText
	} from '$lib/domain/target-project';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { keepFocusAtBar } from '$lib/selection-focus';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { findConnectionNames } from '$lib/stores/connection-names.svelte';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { INBOX_UNAVAILABLE_MESSAGE, type InboxStore } from '$lib/stores/inbox.svelte';
	import type { SyncAllStore } from '$lib/stores/sync-all.svelte';
	import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { captureHref, convertHref, inboxItemHref, withInboxQuery } from '$lib/ticket-links';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';
	import ChipGroup from './ChipGroup.svelte';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import FilterPopover from './FilterPopover.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import FilterButton from './FilterButton.svelte';
	import FilterSheet from './FilterSheet.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MoveSourceDialog from './MoveSourceDialog.svelte';
	import PendingMark from './offline/PendingMark.svelte';
	import ProblemDetails from './problems/ProblemDetails.svelte';
	import SectionBar from './SectionBar.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import ViewSwitch from './ViewSwitch.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';

	// Inbox view (E4 plan, package 3; ADR-0014 sections 3 and 4; ADR-0019 section 6): section bar
	// "Eingang" with the switch and "Gesammelt umwandeln", the chips "Quelle" and "Zustand" (state
	// of the URL), and the table: selection, kind, title (link to the panel) with the hint on a
	// possible duplicate, source, date at the sender, arrival and the actions. New entries are
	// shown newest first, handled ones most recently handled first with "Weitere laden".
	// "Verwerfen" removes the row at once ("Rückgängig" stands in the flag of the store) and moves
	// the focus to the next row; a failed row action becomes an error flag (ADR-0025 section 8).
	// The date at the sender is only shown, never taken as due date (P-5). The table never scrolls
	// sideways (package UI-6b): fitColumns (ADR-0030, package SP-5) fits the columns into the
	// measured frame with the widths of the user; in a narrow frame columns give way in a fixed
	// order, first the arrival (or handling) date, then "Quelle", then "Art", last "Quelldatum";
	// selection, title and the actions always stay, and the caption then names the panel. Grips
	// and the menu "Spalten" change widths and visibility; the title takes at most two lines.
	// Linked entries (ADR-0031, addendum C) carry the row mark in the accent colour and the chip
	// "→ HAUS-12", a link to their ticket; the chip "Zustand" offers "Neu" (default), "Verknüpft",
	// "Verworfen" and "Alle". Every row ends with the menu "•••" (plan aktionsmenues, AM-4), after
	// the buttons the triage needs often, which stay: "Öffnen" and "Link der Quelle öffnen" (an https
	// address, new tab), then by state "Umwandeln …", "Mit Ticket verknüpfen …" and "Verwerfen",
	// "Wiederherstellen" or the ticket with "Anderem Ticket zuordnen …" and "Lösen" (never for the
	// main source, ADR-0031 addendum A), last "Seiteninhalt sichern" and "Originaldatei
	// herunterladen" where they apply (AM-5; the rules shared with panel and ticket in
	// domain/sources.ts). A right click on a row or Shift+F10 open the same menu (AM-3, rowMenus);
	// the browser keeps its menu on the other links of a row.
	// The target project of the entries (ADR-0049 §5): the filter "Zielprojekt" next to the chips (a
	// project with its sub projects, or "Ohne Zielprojekt"), the switch "Nach Zielprojekt gruppieren"
	// (a group of rows per project with its path as heading, "Ohne Zielprojekt" last) and the column
	// "Zielprojekt" in the menu "Spalten", off by default and the first to give way (ADR-0030). All
	// three wait until the server knows the field (`store.targetsReady`).
	// Phone frame (MO-6, ADR-0073 addendum MO-6): with the choice "Handy-Ansicht: Automatisch" and
	// below 40rem the same component shows cards instead of the table, from the same store, groups,
	// menus and links. A card holds the title (up to three lines, the link to the entry), the hint on a
	// possible duplicate, a muted line with kind, source with its connection, the date the list is
	// ordered by, the date at the sender and the target project, the main actions "Umwandeln" and
	// "Verwerfen" (or "Wiederherstellen", or the chip "→ HAUS-12") with 44 px and "•••" with the menu
	// of the row; a tap on the card opens the entry. The row of the view holds "Erfassen", "Filter (n)"
	// (the chips "Quelle" and "Zustand", "Zielprojekt" and the grouping in the filter sheet) and the
	// menu of the list ("Auswählen", "Aus Zwischenablage", "Alle Kanäle jetzt abrufen"); the files come
	// after the list. "Auswählen" shows a box on every new entry for "Gesammelt umwandeln" and "Mit
	// Ticket verknüpfen …", which stand in the bar of the selection at the bottom (MO-7b, SelectionBar,
	// shared with "Aufgaben" and "Papierkorb"). "Spalten" has no place without columns; the entry shows
	// every value.
	// Several entries at once (EG-1, ADR-0014 addendum EG-1): "Verwerfen (n)" stands with the bulk
	// actions of the view "Neu", "Wiederherstellen (n)" alone in the view "Verworfen", whose discarded
	// entries can be chosen as well (box, "Alle", "Auswählen" in the phone frame). The store runs the
	// chosen entries one after the other; the progress and the result (failures, skipped entries,
	// "Ergebnis schließen") stand in the SelectionBar, on the PC above the table only while a run goes
	// on or a result stands, in the phone frame in the bar at the bottom. Its flag offers "Rückgängig"
	// for the discarded ones. The focus stays on the button, in the phone frame it goes back into the
	// bar. Without a connection (`offline`, OF-3) both stay, locked: `aria-disabled`, "Nur mit
	// Verbindung" beside them, and a tap or Enter names it in a flag; since MO-7c1 "Gesammelt umwandeln
	// (n)" and "Mit Ticket verknüpfen … (n)" as well, and "Ergebnis schließen" leaves the focus in the
	// bar or on the heading (lib/selection-focus.ts). Round 2 (after the review): the
	// selection belongs to its view, so another view empties it (and ends "Auswählen"), and an entry
	// that leaves the state of the view drops out; progress and result stand only in the views with a
	// selection; while a run goes on, every bulk action on the PC names the progress as its reason and
	// a click or Enter says so in a flag; a failure of the result offers "Details" (FP-1).
	let {
		store,
		flags,
		sources = null,
		picker,
		openTickets,
		projects = [],
		activeId = null,
		selected = $bindable([]),
		projectsNewCount = 0,
		clipboardHint = null,
		syncAll = null,
		offline = false,
		onclipboard,
		onbulk,
		onlink,
		onlinkitem,
		tools,
		actions
	}: {
		store: InboxStore;
		/** Flags of the app, for failed row actions. */
		flags: FlagSink;
		/**
		 * Sources of tickets (ADR-0031): "Anderem Ticket zuordnen …" and "Lösen" of a linked entry; the
		 * (app) layout provides it. Without it the menu offers neither.
		 */
		sources?: TicketSourcesStore | null;
		/** Tickets of the picker of "Anderem Ticket zuordnen …" (ADR-0042); else from the context. */
		picker?: TicketPickerSource;
		/** Open tickets of the list store, for the hint on possible duplicates. */
		openTickets: readonly TicketSummary[];
		/** Every visible project of the catalog, archived ones included (target projects, ADR-0049). */
		projects?: readonly Project[];
		/** Entry shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** IDs of the chosen new entries. */
		selected?: string[];
		/** New tickets in projects, for the switch (ADR-0015 section 5). */
		projectsNewCount?: number;
		/** "Gesammelt umwandeln" for the chosen entries. */
		onbulk: () => void;
		/** "Mit Ticket verknüpfen …" for the chosen entries (ADR-0031); without it there is no button. */
		onlink?: () => void;
		/** "Mit Ticket verknüpfen …" in the menu of one new entry; without it the menu has none. */
		onlinkitem?: (item: InboxItemSummary) => void;
		/** "Aus Zwischenablage" (E4 plan, package 6); without it there is no button. */
		onclipboard?: () => void;
		/** Why the clipboard could not be read, with the way through Ctrl+V; neutral, no error. */
		clipboardHint?: string | null;
		/**
		 * "Alle Kanäle jetzt abrufen" in the menu of the list in the phone frame (MO-6), with its
		 * status; on the PC the button of `actions` stands in the bar.
		 */
		syncAll?: SyncAllStore | null;
		/**
		 * The connection is missing (OF-3, the state of the outbox): every bulk action stays, locked, and
		 * says why ("Verwerfen (n)" and "Wiederherstellen (n)" since EG-1, "Gesammelt umwandeln (n)" and
		 * "Mit Ticket verknüpfen … (n)" since MO-7c1).
		 */
		offline?: boolean;
		/** Further ways into the inbox under the chips (drop zone for files, package 8). */
		tools?: Snippet;
		/** First actions of the section bar ("Alle Kanäle jetzt abrufen", package A item 4). */
		actions?: Snippet;
	} = $props();

	/** "In den Haushalt verschieben …" of an entry (E7-4, ADR-0061). */
	const mover = areaMover();

	// Ticket links open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		caption: `${uid}-caption`,
		bulkHint: `${uid}-bulk-hint`,
		offlineHint: `${uid}-offline-hint`,
		progress: `${uid}-progress`
	};

	/** Titles from this length get a tooltip with the whole text (only they can be cut off). */
	const LONG_TITLE = 60;

	const STATE_CHIPS: readonly { value: InboxView; label: string }[] = [
		{ value: 'new', label: VIEW_LABELS.new },
		{ value: 'converted', label: VIEW_LABELS.converted },
		{ value: 'discarded', label: VIEW_LABELS.discarded },
		{ value: 'all', label: VIEW_LABELS.all }
	];
	const SOURCE_CHIPS = SOURCE_FAMILY_CHIPS.map((family) => ({
		value: family,
		label: SOURCE_FAMILY_LABELS[family]
	}));

	const query = $derived(store.query);
	const showsNew = $derived(query.state === 'new');
	/** The server knows the target project (ADR-0049): filter, grouping and column are offered. */
	const targetsReady = $derived(store.targetsReady);
	const target = $derived(targetsReady ? (query.target ?? null) : null);
	const grouped = $derived(targetsReady && query.grouped === true);
	const filtered = $derived(query.source !== null || target !== null);
	const targetOptions = $derived([
		{ value: NO_TARGET, label: 'Ohne Zielprojekt' },
		...treeOrder(projects.filter((project) => !project.archived)).map((project) => ({
			value: project.id,
			label: projectChoiceLabel(project)
		})),
		...treeOrder(projects.filter((project) => project.archived)).map((project) => ({
			value: project.id,
			label: projectChoiceLabel(project),
			section: 'Archiviert'
		}))
	]);
	const groupSwitchId = `${uid}-group-target`;
	/** New entries and the view "Alle" are ordered by arrival, the others by their handling. */
	const byArrival = $derived(query.state === 'new' || query.state === 'all');
	const rows = $derived(store.visible);
	/**
	 * The bulk action of the view (EG-1): "Verwerfen (n)" with the new entries, "Wiederherstellen (n)"
	 * with the discarded ones; the views "Verknüpft" and "Alle" have no selection.
	 */
	const bulkKind = $derived(bulkKindOf(query.state));
	/**
	 * Whether an entry may be chosen: one in the state of the view (new, or discarded since EG-1), but
	 * not one "＋" put into the inbox that the server does not have yet (OF-4a round 2, A2).
	 */
	const choosable = (item: InboxItemSummary) =>
		bulkKind !== null && item.state === BULK_STATES[bulkKind] && !store.isCreated(item.id);
	/** Chosen entries that are shown and still in the state of the view (another one drops out). */
	const chosen = $derived(rows.filter((item) => choosable(item) && selected.includes(item.id)));
	const selectable = $derived(rows.filter(choosable));
	const allChosen = $derived(selectable.length > 0 && chosen.length === selectable.length);
	const ready = $derived(
		showsNew ? store.state === 'ready' : store.state === 'ready' && store.handledLoad === 'ready'
	);
	const unavailable = $derived(store.state === 'error' && store.error !== null);
	const countLabel = $derived(
		rows.length === 1 ? '1 Eintrag' : `${rows.length}${store.handledHasMore ? '+' : ''} Einträge`
	);
	const caption = $derived(
		`${
			showsNew
				? 'Eingang · neu, neueste zuerst'
				: query.state === 'all'
					? 'Eingang · alle, neueste zuerst'
					: query.state === 'discarded'
						? 'Eingang · verworfen, zuletzt verworfene zuerst'
						: 'Eingang · verknüpft, zuletzt verknüpfte zuerst'
		}${grouped ? ', nach Zielprojekt gruppiert' : ''}`
	);
	/** The rows in groups by target project, or one group without heading. */
	const groups = $derived(
		grouped ? groupByTarget(rows, projects) : [{ key: '', label: '', items: [...rows] }]
	);

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	// Columns (ADR-0030): the selection exists only in the views "Neu" and (since EG-1) "Verworfen",
	// the target project only once the server knows it (ADR-0049).
	const columnFit = new ColumnFit(getColumnPrefs('inbox'), () =>
		INBOX_TABLE.columns.filter(
			(column) =>
				(bulkKind !== null || column.id !== 'select') && (targetsReady || column.id !== 'target')
		)
	);
	const shown = $derived(columnFit.shown);
	let frame = $state<HTMLElement>();

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

	/**
	 * Failure of a row action (discard, restore, assign) as an error flag; it stays until closed. The
	 * failed request comes along for "Details" (FP-1, ADR-0071).
	 */
	function fail(message: string | null | undefined, problem?: ProblemEntry | null) {
		if (message) flags.show({ tone: 'error', title: message, ...(problem && { problem }) });
	}

	async function navigate(next: InboxQuery) {
		await goto(withInboxQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	/** "Filter zurücksetzen": source and target project; state and grouping stay. */
	async function clearFilters() {
		await navigate({ ...query, source: null, target: null });
		heading?.focus();
	}

	function toggle(id: string, on: boolean) {
		selected = on
			? [...selected.filter((entry) => entry !== id), id]
			: selected.filter((entry) => entry !== id);
	}

	function toggleAll(on: boolean) {
		selected = on ? selectable.map((item) => item.id) : [];
	}

	/** The title links of the rows of the table, or of the cards in the phone frame (MO-6). */
	function titleLinks(): HTMLElement[] {
		return [...(root?.querySelectorAll<HTMLElement>('[data-item-id] a.title-link') ?? [])];
	}

	/** The entry of the row or card a title link stands in. */
	function itemOfLink(link: HTMLElement): string | undefined {
		return link.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
	}

	/** Position of the row of an entry among the rows, -1 without one. */
	function rowIndex(id: string): number {
		return titleLinks().findIndex((link) => itemOfLink(link) === id);
	}

	/** The row of an entry left: the focus goes to the row at its place, else the last, else the heading. */
	async function focusNear(id: string, index: number) {
		await tick();
		const links = titleLinks().filter((link) => itemOfLink(link) !== id);
		const next = links[Math.min(index, links.length - 1)];
		(next ?? heading)?.focus();
	}

	/** After "Verwerfen" the focus goes to the next row, else the previous one, else the heading. */
	async function discard(item: InboxItemSummary) {
		const index = rowIndex(item.id);
		const result = await store.discard(item.id);
		if (!result.ok) {
			fail(result.message, result.problem);
			return;
		}
		selected = selected.filter((entry) => entry !== item.id);
		await focusNear(item.id, index);
	}

	/** The SelectionBar of a running bulk action and of its result (EG-1). */
	let bulkBar = $state<HTMLElement>();
	const bulkRunning = $derived(store.bulkProgress !== null);
	/** Progress and result stand only in a view with a selection, never with "0 …" alone elsewhere. */
	const bulkBarShown = $derived(
		bulkKind !== null && (store.bulkProgress !== null || store.bulkResult !== null)
	);

	/**
	 * Whether a bulk action of the view is locked by a running run; then a click or Enter names why in
	 * a flag, like a locked action without a connection (EG-1 round 2).
	 */
	function lockedByRun(label: string): boolean {
		const running = store.bulkProgress;
		if (running === null) return false;
		flags.show({ tone: 'info', title: bulkRunningText(label, running.label) });
		return true;
	}

	/**
	 * "Verwerfen (n)" or "Wiederherstellen (n)" of the chosen entries (EG-1); while a run goes on or
	 * without a connection it only names why. Entries the run changed leave the selection (they left
	 * the view), a failed one stays chosen for another try. The focus stays on the button; in the
	 * phone frame, where the actions close, it goes back into the bar (as in BulkActionBar).
	 */
	async function runBulk(kind: InboxBulkKind, label: string) {
		if (chosen.length === 0 || lockedByRun(label)) return;
		if (offline) {
			flags.show({ tone: 'info', title: bulkOfflineText(label) });
			return;
		}
		const entries = chosen.map(({ id, title }) => ({ id, title }));
		if (kind === 'discard') await store.discardMany(entries);
		else await store.restoreMany(entries);
		await tick();
		if (phone && bulkBar && !bulkBar.contains(document.activeElement)) {
			bulkBar.querySelector<HTMLElement>('button:not([disabled]), [tabindex]')?.focus();
		}
	}

	/**
	 * "Gesammelt umwandeln (n)" and "Mit Ticket verknüpfen … (n)": while a run goes on or without a
	 * connection they only name why (MO-7c1, like "Verwerfen (n)" of EG-1), else they start.
	 */
	function startBulk(label: string, start: () => void) {
		if (chosen.length === 0 || lockedByRun(label)) return;
		if (offline) {
			flags.show({ tone: 'info', title: bulkOfflineText(label) });
			return;
		}
		start();
	}

	/** "Ergebnis schließen": the focus stays in the bar or goes to the heading (MO-7c1, Q-1). */
	async function closeBulkResult() {
		const away = heading;
		store.dismissBulkResult();
		await tick();
		keepFocusAtBar(bulkBar, away);
	}

	/**
	 * "Lösen" of a linked entry from the menu of its row (ADR-0031 section 2), like in the panel: the
	 * store shows the flag of success or failure. Released, the entry leaves the view "Verknüpft";
	 * the focus then goes to the next row, as after "Verwerfen".
	 */
	async function release(item: InboxItemSummary) {
		if (sources === null) return;
		const index = rowIndex(item.id);
		const result = await sources.release(item);
		if (!result.ok) return;
		await tick();
		if (rowIndex(item.id) === -1) await focusNear(item.id, index);
	}

	/** Entry of the dialog "Anderem Ticket zuordnen …" (ADR-0031 addendum A), null while closed. */
	let moving = $state<InboxItemSummary | null>(null);
	/** The ticket the entry of the dialog belongs to now. */
	const movingFrom = $derived(
		moving !== null && moving.ticketId !== null && moving.ticket?.id === moving.ticketId
			? { id: moving.ticketId, key: moving.ticket.key }
			: null
	);

	/** Entry whose page is being saved from the menu of its row (one at a time). */
	let saving = $state<string | null>(null);

	/**
	 * "Seiteninhalt sichern" of a row (ADR-0031 section 6), as in the panel: the store shows the flag
	 * of success, the entry changes through its realtime event. A refusal becomes an error flag
	 * with the reason of the server, as for every failed row action.
	 */
	async function savePage(item: InboxItemSummary) {
		if (saving !== null) return;
		saving = item.id;
		try {
			const result = await store.savePage(item);
			if (!result.ok && result.message !== null) {
				fail(
					`Seite von „${item.title}“ ließ sich nicht sichern: ${result.message}`,
					result.problem
				);
			}
		} finally {
			saving = null;
		}
	}

	async function act(
		action: () => Promise<{ ok: boolean; message?: string | null; problem?: ProblemEntry }>
	) {
		const result = await action();
		if (!result.ok) fail(result.message, result.problem);
	}

	/** Entry whose original file is being fetched from the menu of its row (one at a time). */
	let downloading = $state<string | null>(null);

	/** "Originaldatei herunterladen" of a row, as in the panel: a fresh file token, then the file. */
	async function download(item: InboxItemSummary) {
		if (downloading !== null) return;
		downloading = item.id;
		try {
			const result = await store.originalUrl(item);
			if (result.ok) window.location.assign(result.url);
			else fail(result.message, result.problem);
		} finally {
			downloading = null;
		}
	}

	/**
	 * The entries of the menu "•••" of a row (AM-4, AM-5), by the state of the entry: what opens it,
	 * what changes its state, what keeps its copy. Each only where the panel offers it.
	 */
	function menuOf(item: InboxItemSummary, ticketKey: string | null): MenuAction[] {
		const pending = store.isPending(item.id);
		const entries: MenuAction[] = [{ label: 'Öffnen', href: inboxItemHref(item.id, page.url) }];
		// The address of the source, outside the app: ActionsMenu takes only https (ExternalLink).
		if (item.sourceUrl !== '') {
			entries.push({ label: 'Link der Quelle öffnen', external: item.sourceUrl });
		}
		if (item.state === 'new') {
			entries.push({ label: 'Umwandeln …', href: convertHref(item.id), separated: true });
			if (onlinkitem) {
				const link = onlinkitem;
				entries.push({
					label: 'Mit Ticket verknüpfen …',
					dialog: true,
					locked: pending,
					onselect: () => link(item)
				});
			}
			entries.push({ label: 'Verwerfen', busy: pending, onselect: () => void discard(item) });
		} else if (item.state === 'discarded') {
			entries.push({
				label: 'Wiederherstellen',
				separated: true,
				busy: pending,
				onselect: () => void act(() => store.restore(item.id))
			});
		} else if (item.ticketId !== null) {
			entries.push({
				label: ticketKey === null ? 'Ticket öffnen' : `Ticket ${ticketKey} öffnen`,
				href: links.path(item.ticketId),
				separated: true
			});
			// Never for the main source of the ticket (ADR-0031 addendum A); the panel says why.
			if (sources !== null && canLeaveTicket(item, isMainSource(item))) {
				const changing = sources.isPending(item.id);
				entries.push(
					{
						label: 'Anderem Ticket zuordnen …',
						dialog: true,
						locked: changing,
						onselect: () => (moving = item)
					},
					{ label: 'Lösen', busy: changing, onselect: () => void release(item) }
				);
			}
		}
		// Moving between the areas (E7-4, ADR-0061): only an entry without a ticket; one with a ticket
		// moves with its ticket.
		const move =
			item.ticketId === null
				? mover.entry({ kind: 'item', records: [item], label: `Eintrag „${item.title}“` })
				: null;
		if (move !== null) entries.push({ label: move.label, dialog: true, onselect: move.run });
		// A web link without its page has no original file yet: at most one of the two.
		if (canSavePage(item)) {
			entries.push({
				label: 'Seiteninhalt sichern',
				separated: true,
				busy: saving === item.id,
				locked: saving !== item.id && (saving !== null || pending),
				onselect: () => void savePage(item)
			});
		}
		if (item.original !== '') {
			entries.push({
				label: 'Originaldatei herunterladen',
				separated: true,
				busy: downloading === item.id,
				locked: downloading !== null && downloading !== item.id,
				onselect: () => void download(item)
			});
		}
		return entries;
	}

	/** Entry whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (link, Escape, browser back) returns the focus to the row of its entry, or
	// to the heading if the row is gone.
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			const active = document.activeElement;
			if (active !== null && active !== document.body) return;
			const link = titleLinks().find((entry) => itemOfLink(entry) === previous);
			(link ?? heading)?.focus();
		});
	});

	function sourceDateOf(
		item: InboxItemSummary
	): { date: string; text: string; title: string } | null {
		if (item.sourceDate === null) return null;
		const date = berlinDateOf(item.sourceDate);
		return { date, text: formatCalendarDate(date), title: formatBerlinDateTime(item.sourceDate) };
	}

	/** The phone frame (MO-6): cards instead of the table, the filters in a sheet. */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);
	/** Names of the connections (ADR-0026, addendum KK-3), as the panel names the source. */
	const connectionNames = findConnectionNames();

	/** The filter sheet and the number of the filters "Zurücksetzen" clears (source, target). */
	let filtersOpen = $state(false);
	const filterCount = $derived((query.source !== null ? 1 : 0) + (target !== null ? 1 : 0));

	/** "Zurücksetzen" of the sheet: like "Filter zurücksetzen", the sheet stays open. */
	function resetInSheet() {
		void navigate({ ...query, source: null, target: null });
	}

	// "Auswählen" in the phone frame (MO-6, the way of MO-3): the boxes of the selection show on the
	// new entries (since EG-1 on the discarded ones in "Verworfen") while the mode is on or something
	// is chosen; "Fertig" leaves it and clears it.
	let selectMode = $state(false);
	const selecting = $derived(phone && bulkKind !== null && (selectMode || chosen.length > 0));

	function leaveSelectMode() {
		selectMode = false;
		selected = [];
	}

	// The selection belongs to its view (EG-1 round 2): another view ("Neu", "Verworfen", "Verknüpft",
	// "Alle") empties it and ends "Auswählen", so nothing comes along chosen into another view.
	let selectionView: InboxView | null = null;
	$effect(() => {
		const view = query.state;
		const previous = selectionView;
		selectionView = view;
		if (previous === null || previous === view) return;
		selected = [];
		selectMode = false;
	});

	/**
	 * A chosen entry left the state of the view (its row action, a conversion, another tab): the store
	 * knows it in another state, or in "Neu", where it holds every new entry, no longer at all.
	 */
	function leftView(kind: InboxBulkKind, id: string): boolean {
		const known = store.find(id);
		if (known !== null) return known.state !== BULK_STATES[kind];
		return kind === 'discard' && store.state === 'ready';
	}

	// Such an entry leaves the selection, so it is not chosen again when it comes back.
	$effect(() => {
		const kind = bulkKind;
		if (kind === null) return;
		const kept = selected.filter((id) => !leftView(kind, id));
		if (kept.length !== selected.length) selected = kept;
	});

	/** The menu "•••" of the list in the phone frame: what the bar of the PC shows besides. */
	const listActions = $derived.by((): MenuAction[] => {
		const entries: MenuAction[] = [];
		if (bulkKind !== null && selectable.length > 0) {
			entries.push({ label: 'Auswählen', locked: selecting, onselect: () => (selectMode = true) });
		}
		const clipboard = onclipboard;
		if (clipboard) entries.push({ label: 'Aus Zwischenablage', onselect: () => clipboard() });
		const sync = syncAll;
		if (sync !== null) {
			// Without a connection (OF-3) the entry stays, locked, and names why.
			const syncLocked = sync.offline && !sync.running;
			entries.push({
				label: syncLocked ? SYNC_OFFLINE_LABEL : 'Alle Kanäle jetzt abrufen',
				busy: sync.running,
				locked: syncLocked,
				onselect: () => void sync.runAll()
			});
		}
		return entries;
	});

	/** A tap on a card opens its entry, or chooses it while choosing (MO-6). */
	function tapCard(event: MouseEvent, item: InboxItemSummary) {
		if (!isCardTap(event)) return;
		if (!selecting || bulkKind === null || item.state !== BULK_STATES[bulkKind]) {
			void goto(inboxItemHref(item.id, page.url));
		} else if (choosable(item)) {
			// One "＋" put in that the server does not have yet is not chosen (OF-4a round 2, A2).
			toggle(item.id, !selected.includes(item.id));
		}
	}
</script>

{#snippet duplicateHint(item: InboxItemSummary)}
	{@const duplicates = store.softDuplicates(item, openTickets)}
	{@const ticket = duplicates.tickets[0]}
	{@const other = duplicates.items[0]}
	{#if ticket !== undefined || other !== undefined}
		<p class="duplicate">
			<span class="duplicate-label">Mögliches Duplikat:</span>
			{#if ticket !== undefined}
				<a href={links.path(ticket.id)} data-ticket-link={ticket.id}>{ticket.key}</a>
				<button
					class="text-button"
					type="button"
					disabled={store.isPending(item.id)}
					aria-busy={store.isPending(item.id) ? 'true' : undefined}
					onclick={() => act(() => store.assign(item.id, ticket.id, ticket.key))}
				>
					Dem Ticket {ticket.key} zuordnen
				</button>
			{:else if other !== undefined}
				<a href={inboxItemHref(other.id, page.url)}>anderer Eintrag „{other.title}“</a>
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet row(item: InboxItemSummary)}
	{@const pending = store.isPending(item.id)}
	{@const sourceDate = sourceDateOf(item)}
	{@const arrival = byArrival ? item.created : (item.handledAt ?? item.created)}
	{@const linkedTicket =
		item.state === 'converted' && item.ticket?.id === item.ticketId ? item.ticket : null}
	<tr
		class="row"
		class:active={item.id === activeId}
		class:linked={item.state === 'converted' && item.ticketId !== null}
		data-item-id={item.id}
	>
		{#if shown.has('select')}
			<td class="select" data-col="select">
				{#if !store.isCreated(item.id)}
					<input
						type="checkbox"
						aria-label={`Eintrag „${item.title}“ auswählen`}
						checked={selected.includes(item.id)}
						onchange={(event) => toggle(item.id, event.currentTarget.checked)}
					/>
				{/if}
			</td>
		{/if}
		{#if shown.has('kind')}
			<td class="kind" data-col="kind">{KIND_LABELS[item.kind]}</td>
		{/if}
		<th class="title" scope="row" data-col="title">
			<!-- At most two lines, cut off only visually (ADR-0030 section 6). -->
			<div class="title-clamp">
				<a
					class="title-link"
					href={inboxItemHref(item.id, page.url)}
					data-row-link
					title={item.title.length >= LONG_TITLE ? item.title : undefined}
					aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
				><PendingMark id={item.id} />
			</div>
			{#if item.state === 'new'}
				{@render duplicateHint(item)}
			{/if}
		</th>
		{#if shown.has('source')}
			<td class="source" data-col="source">{CHANNEL_LABELS[item.channel]}</td>
		{/if}
		{#if shown.has('target')}
			{@const targetLabel = targetText(targetOfItem(item, projects))}
			<td class="target" data-col="target" title={targetLabel || undefined}>
				{#if targetLabel !== ''}
					{targetLabel}
				{:else}
					<span aria-hidden="true">–</span><span class="visually-hidden">kein Zielprojekt</span>
				{/if}
			</td>
		{/if}
		{#if shown.has('source-date')}
			<td class="date" data-col="source-date">
				{#if sourceDate !== null}
					<time datetime={sourceDate.date} title={sourceDate.title}>{sourceDate.text}</time>
				{:else}
					<span aria-hidden="true">–</span><span class="visually-hidden">kein Datum</span>
				{/if}
			</td>
		{/if}
		{#if shown.has('arrival')}
			<td class="date" data-col="arrival">
				<time datetime={berlinDateOf(arrival)} title={formatBerlinDateTime(arrival)}>
					{formatCalendarDate(berlinDateOf(arrival))}
				</time>
			</td>
		{/if}
		<td
			class="actions"
			data-col="actions"
			aria-busy={downloading === item.id ||
			saving === item.id ||
			(sources?.isPending(item.id) ?? false)
				? 'true'
				: undefined}
		>
			<span class="action-group">
				{#if store.isCreated(item.id)}
					<!-- "＋" without a connection (OF-4a): nothing that needs the server until it has it. -->
				{:else if item.state === 'new'}
					<a class="action primary" href={convertHref(item.id)}
						>Umwandeln<span class="visually-hidden">: „{item.title}“</span></a
					>
					<button
						class="action"
						type="button"
						disabled={pending}
						aria-busy={pending ? 'true' : undefined}
						onclick={() => discard(item)}
					>
						Verwerfen<span class="visually-hidden">: „{item.title}“</span>
					</button>
				{:else if item.state === 'discarded'}
					<button
						class="action"
						type="button"
						disabled={pending}
						aria-busy={pending ? 'true' : undefined}
						onclick={() => act(() => store.restore(item.id))}
					>
						Wiederherstellen<span class="visually-hidden">: „{item.title}“</span>
					</button>
				{:else if linkedTicket !== null}
					<a
						class="ticket-chip"
						href={links.path(linkedTicket.id)}
						data-ticket-link={linkedTicket.id}
						title={`${linkedTicket.key} · ${linkedTicket.title}`}
						aria-label={`Ticket ${linkedTicket.key} öffnen: „${item.title}“`}
						>→ <span class="ticket-key">{linkedTicket.key}</span></a
					>
				{:else if item.ticketId !== null}
					<a class="action" href={links.path(item.ticketId)} data-ticket-link={item.ticketId}
						>Ticket ansehen<span class="visually-hidden">: „{item.title}“</span></a
					>
				{/if}
				{#if !store.isCreated(item.id)}
					<ActionsMenu
						label={`Weitere Aktionen für „${item.title}“`}
						buttonLabel={`Weitere Aktionen für „${item.title}“`}
						buttonTitle="Weitere Aktionen"
						buttonClass="button-icon row-menu"
						items={menuOf(item, linkedTicket?.key ?? null)}
					/>
				{/if}
			</span>
		</td>
	</tr>
{/snippet}

<!-- An entry as a card in the phone frame (MO-6): the counterpart of a row, with its parts. -->
{#snippet card(item: InboxItemSummary)}
	{@const pending = store.isPending(item.id)}
	{@const sourceDate = sourceDateOf(item)}
	{@const arrival = byArrival ? item.created : (item.handledAt ?? item.created)}
	{@const linkedTicket =
		item.state === 'converted' && item.ticket?.id === item.ticketId ? item.ticket : null}
	{@const targetLabel = targetsReady ? targetText(targetOfItem(item, projects)) : ''}
	{@const choosing = selecting && choosable(item)}
	<!-- The title link is the keyboard target of the card; the tap on the card is a shortcut for it. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<li
		class="inbox-card"
		class:active={item.id === activeId}
		class:linked={item.state === 'converted' && item.ticketId !== null}
		class:chosen={choosing && selected.includes(item.id)}
		data-item-id={item.id}
		data-menu-row
		onclick={(event) => tapCard(event, item)}
	>
		{#if choosing}
			<!-- The whole target is the label: a tap anywhere in it chooses. -->
			<label class="check-target">
				<input
					type="checkbox"
					aria-label={`Eintrag „${item.title}“ auswählen`}
					checked={selected.includes(item.id)}
					onchange={(event) => toggle(item.id, event.currentTarget.checked)}
				/>
			</label>
		{/if}
		<div class="card-body">
			<!-- Up to three lines, cut off only visually; screen readers read the whole title. -->
			<p class="card-title">
				<a
					class="title-link"
					href={inboxItemHref(item.id, page.url)}
					data-row-link
					title={item.title.length >= LONG_TITLE ? item.title : undefined}
					aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
				><PendingMark id={item.id} />
			</p>
			{#if item.state === 'new'}
				{@render duplicateHint(item)}
			{/if}
			<p class="card-meta">
				<span>{KIND_LABELS[item.kind]}</span>
				<span
					>{withConnectionName(
						CHANNEL_LABELS[item.channel],
						connectionNames?.nameOf(item.connectionId) ?? null
					)}</span
				>
				<span class="card-date">
					{byArrival ? 'Eingang' : VIEW_LABELS[query.state]}
					<time datetime={berlinDateOf(arrival)} title={formatBerlinDateTime(arrival)}>
						{formatCalendarDate(berlinDateOf(arrival))}
					</time>
				</span>
				{#if sourceDate !== null}
					<span class="card-date">
						Quelldatum
						<time datetime={sourceDate.date} title={sourceDate.title}>{sourceDate.text}</time>
					</span>
				{/if}
				{#if targetLabel !== ''}
					<span>{TARGET_LABEL} {targetLabel}</span>
				{/if}
			</p>
			<div
				class="card-actions"
				aria-busy={downloading === item.id ||
				saving === item.id ||
				(sources?.isPending(item.id) ?? false)
					? 'true'
					: undefined}
			>
				{#if store.isCreated(item.id)}
					<!-- "＋" without a connection (OF-4a): nothing that needs the server until it has it. -->
				{:else if item.state === 'new'}
					<a class="button-secondary card-convert" href={convertHref(item.id)}
						>Umwandeln<span class="visually-hidden">: „{item.title}“</span></a
					>
					<button
						class="button-secondary"
						type="button"
						disabled={pending}
						aria-busy={pending ? 'true' : undefined}
						onclick={() => discard(item)}
					>
						Verwerfen<span class="visually-hidden">: „{item.title}“</span>
					</button>
				{:else if item.state === 'discarded'}
					<button
						class="button-secondary"
						type="button"
						disabled={pending}
						aria-busy={pending ? 'true' : undefined}
						onclick={() => act(() => store.restore(item.id))}
					>
						Wiederherstellen<span class="visually-hidden">: „{item.title}“</span>
					</button>
				{:else if linkedTicket !== null}
					<a
						class="ticket-chip"
						href={links.path(linkedTicket.id)}
						data-ticket-link={linkedTicket.id}
						title={`${linkedTicket.key} · ${linkedTicket.title}`}
						aria-label={`Ticket ${linkedTicket.key} öffnen: „${item.title}“`}
						>→ <span class="ticket-key">{linkedTicket.key}</span></a
					>
				{:else if item.ticketId !== null}
					<a
						class="button-secondary"
						href={links.path(item.ticketId)}
						data-ticket-link={item.ticketId}
						>Ticket ansehen<span class="visually-hidden">: „{item.title}“</span></a
					>
				{/if}
			</div>
		</div>
		<div class="card-end">
			{#if !store.isCreated(item.id)}
				<ActionsMenu
					label={`Weitere Aktionen für „${item.title}“`}
					buttonLabel={`Weitere Aktionen für „${item.title}“`}
					buttonTitle="Weitere Aktionen"
					buttonClass="button-icon row-menu"
					items={menuOf(item, linkedTicket?.key ?? null)}
				/>
			{/if}
		</div>
	</li>
{/snippet}

<!-- "Gesammelt umwandeln", "Mit Ticket verknüpfen …" and "Verwerfen (n)" for the chosen new entries;
     "Wiederherstellen (n)" for the chosen discarded ones (EG-1). While a run goes on, all wait and
     name the progress as their reason (EG-1 round 2). Without a connection every one of them stays,
     locked, and names why ("Verwerfen (n)" and "Wiederherstellen (n)" since EG-1, "Gesammelt
     umwandeln (n)" and "Mit Ticket verknüpfen … (n)" since MO-7c1). -->
{#snippet bulkButtons()}
	{@const count = chosen.length > 0 ? ` (${chosen.length})` : ''}
	{@const describedBy = chosen.length === 0 ? ids.bulkHint : bulkRunning ? ids.progress : undefined}
	{@const locked = chosen.length > 0 && offline}
	{#if showsNew}
		{@const convertLabel = `Gesammelt umwandeln${count}`}
		<button
			class="bulk"
			type="button"
			aria-disabled={chosen.length === 0 || locked || bulkRunning ? 'true' : undefined}
			aria-describedby={describedBy ?? (locked ? ids.offlineHint : undefined)}
			title={locked ? BULK_OFFLINE_HINT : undefined}
			onclick={() => startBulk(convertLabel, onbulk)}
		>
			{convertLabel}
		</button>
		{#if onlink}
			{@const link = onlink}
			{@const linkLabel = `Mit Ticket verknüpfen …${count}`}
			<button
				class="bulk"
				type="button"
				aria-disabled={chosen.length === 0 || locked || bulkRunning ? 'true' : undefined}
				aria-describedby={describedBy ?? (locked ? ids.offlineHint : undefined)}
				title={locked ? BULK_OFFLINE_HINT : undefined}
				onclick={() => startBulk(linkLabel, link)}
			>
				{linkLabel}
			</button>
		{/if}
	{/if}
	{#if bulkKind !== null}
		{@const kind = bulkKind}
		{@const label = `${BULK_LABELS[kind]}${count}`}
		<button
			class="bulk"
			type="button"
			aria-disabled={chosen.length === 0 || locked || bulkRunning ? 'true' : undefined}
			aria-busy={bulkRunning ? 'true' : undefined}
			aria-describedby={describedBy ?? (locked ? ids.offlineHint : undefined)}
			title={locked ? BULK_OFFLINE_HINT : undefined}
			onclick={() => void runBulk(kind, label)}
		>
			{label}
		</button>
	{/if}
	{#if chosen.length === 0}
		<span class="hint" id={ids.bulkHint}>Erst Einträge auswählen.</span>
	{:else if offline}
		<span class="hint offline-hint" id={ids.offlineHint}>{BULK_OFFLINE_HINT}</span>
	{/if}
{/snippet}

<!-- The result of the last bulk action of EG-1: failures as errors, each with "Details" of its
     request (FP-1, like one failed action), skipped entries neutral. -->
{#snippet bulkResultList()}
	{#if store.bulkResult}
		{@const result = store.bulkResult}
		{#if result.failures.length > 0}
			<div class="alert-error bulk-failures" role="alert">
				<ErrorIcon />
				<div>
					<p class="result-title">{bulkFailureTitle(result.failures.length, result.verb)}</p>
					<ul>
						{#each result.failures as failure (failure.id)}
							<li>
								<span>„{failure.title}“: {failure.reason}</span>
								<ProblemDetails problem={failure.problem} />
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
		{#if result.skipped.length > 0}
			<SectionMessage tone="info" compact>
				{bulkSkippedTitle(result.skipped.length)}
				<ul class="bulk-skipped">
					{#each result.skipped as skip (skip.id)}
						<li>„{skip.title}“: {skip.reason}</li>
					{/each}
				</ul>
			</SectionMessage>
		{/if}
		<button class="text-button result-close" type="button" onclick={() => void closeBulkResult()}>
			Ergebnis schließen
		</button>
	{/if}
{/snippet}

<!-- The SelectionBar of "Auswählen" (phone frame) or of a running bulk action and its result (EG-1). -->
{#snippet selectionBar(barSelecting: boolean)}
	<SelectionBar
		countText={chosen.length === 1
			? '1 Eintrag ausgewählt'
			: `${chosen.length} Einträge ausgewählt`}
		progress={store.bulkProgress
			? {
					total: store.bulkProgress.total,
					done: store.bulkProgress.done,
					text: bulkProgressText(store.bulkProgress)
				}
			: null}
		progressId={ids.progress}
		actionsShown={phone && chosen.length > 0}
		hint="Erst Einträge auswählen."
		onclear={leaveSelectMode}
		selecting={barSelecting}
		bind:bar={bulkBar}
		actions={bulkButtons}
		result={store.bulkResult && !bulkRunning ? bulkResultList : undefined}
	/>
{/snippet}

<!-- The chips of the URL, the target project and the grouping: above the table, in the sheet (MO-6). -->
{#snippet filterParts()}
	<ChipGroup
		legend="Quelle"
		name={`${uid}-source`}
		options={SOURCE_CHIPS}
		value={query.source}
		onchange={(value: SourceFamily | null) => navigate({ ...query, source: value })}
	/>
	<ChipGroup
		legend="Zustand"
		name={`${uid}-state`}
		options={STATE_CHIPS}
		value={query.state}
		all={null}
		onchange={(value: InboxView | null) => navigate({ ...query, state: value ?? 'new' })}
	/>
	{#if targetsReady}
		<div class="target-tools">
			<FilterPopover
				legend={TARGET_LABEL}
				name={`${uid}-target`}
				options={targetOptions}
				value={target}
				onchange={(value) => navigate({ ...query, target: value })}
			/>
			<label class="group-switch" for={groupSwitchId}>
				<span>Nach Zielprojekt gruppieren</span>
				<input
					id={groupSwitchId}
					type="checkbox"
					role="switch"
					checked={grouped}
					onchange={(event) => navigate({ ...query, grouped: event.currentTarget.checked })}
				/>
			</label>
		</div>
	{/if}
{/snippet}

{#snippet sheetFilters()}
	<div class="sheet-filters">{@render filterParts()}</div>
{/snippet}

<!-- The row of the view in the phone frame (MO-6): "Erfassen", "Filter (n)" and the menu of the list. -->
{#snippet phoneTools()}
	<a class="button-secondary" href={captureHref(page.url)}>Erfassen</a>
	<FilterButton count={filterCount} onclick={() => (filtersOpen = true)} />
	{#if listActions.length > 0}
		<ActionsMenu
			label="Aktionen der Liste"
			buttonLabel="Weitere Aktionen der Liste"
			items={listActions}
		/>
	{/if}
{/snippet}

<section class="inbox-table" aria-labelledby={ids.heading} bind:this={root}>
	<SectionBar
		title="Eingang"
		headingId={ids.heading}
		count={ready ? `${rows.length}${store.handledHasMore ? '+' : ''}` : null}
		{countLabel}
		phone={phoneTools}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="inbox" inboxCount={store.newCount} {projectsNewCount} />
		{/snippet}
		{#snippet end()}
			{@render actions?.()}
			<a class="capture" href={captureHref(page.url)}>Erfassen</a>
			{#if onclipboard}
				<button class="capture" type="button" aria-keyshortcuts="Control+V" onclick={onclipboard}>
					Aus Zwischenablage
				</button>
			{/if}
			{#if bulkKind !== null}
				{@render bulkButtons()}
			{/if}
			<ColumnsPopover fit={columnFit} always="Auswahl, Titel und Aktionen sind immer sichtbar." />
		{/snippet}
	</SectionBar>

	{#if phone}
		{#if syncAll !== null}
			<!-- The status of "Alle Kanäle jetzt abrufen" from the menu of the list; the result is a flag. -->
			<p class="sync-status" role="status">{syncAll.running ? syncAll.status : ''}</p>
		{/if}
		{#if selecting}
			<!-- "Auswählen" (MO-6): all new entries shown; the bulk actions and the way out ("Fertig")
			     are in the bar of the selection at the bottom since MO-7b. -->
			<div class="select-mode" role="group" aria-label="Auswahl">
				<label class="select-all">
					<input
						type="checkbox"
						aria-label="Alle angezeigten Einträge auswählen"
						checked={allChosen}
						disabled={selectable.length === 0}
						onchange={(event) => toggleAll(event.currentTarget.checked)}
					/>
					Alle
				</label>
			</div>
		{/if}
	{:else}
		<div class="chips">
			{@render filterParts()}
		</div>

		{@render tools?.()}
	{/if}

	<div role="status">
		{#if clipboardHint}
			<p class="clipboard-hint">{clipboardHint}</p>
		{/if}
	</div>

	{#if !phone && bulkBarShown}
		<!-- A running bulk action of EG-1 and its result above the table, like the bar of the trash;
		     the buttons stay in the section bar. -->
		{@render selectionBar(true)}
	{/if}

	{#snippet failure(message: string, problem: ProblemEntry | null = null)}
		<SectionMessage tone="error" live {problem}>
			{message}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => store.reload()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{/snippet}

	{#if unavailable && store.error}
		{#if store.error === INBOX_UNAVAILABLE_MESSAGE}
			<SectionMessage tone="info" live>{store.error}</SectionMessage>
		{:else}
			{@render failure(store.error, store.errorProblem)}
		{/if}
	{:else if !showsNew && store.handledLoad === 'error' && store.handledError}
		{@render failure(store.handledError)}
	{:else if ready && rows.length === 0 && !store.handledHasMore}
		{#if filtered}
			<EmptyState
				size="narrow"
				icon="search"
				title="Keine Einträge für diese Filter"
				description={target === null
					? 'Andere Quellen wählen oder den Filter zurücksetzen.'
					: 'Andere Quellen oder ein anderes Zielprojekt wählen oder die Filter zurücksetzen.'}
			>
				{#snippet primary()}
					<button class="button-primary" type="button" onclick={clearFilters}>
						Filter zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else if showsNew}
			<EmptyState
				icon="inbox"
				title="Der Eingang ist leer"
				description="Hier landet, was du erfasst oder was deine Kanäle abrufen."
			>
				{#snippet primary()}
					<a class="button-primary" href={captureHref(page.url)}>Erfassen</a>
				{/snippet}
				{#snippet secondary()}
					<a class="button-subtle" href={resolve('/einstellungen/kanaele')}>Kanal einrichten</a>
				{/snippet}
			</EmptyState>
		{:else if query.state === 'discarded'}
			<EmptyState
				size="narrow"
				icon="inbox"
				title="Keine verworfenen Einträge"
				description="Verworfenes bleibt hier; der Inhalt wird nach 30 Tagen geleert."
			/>
		{:else if query.state === 'all'}
			<EmptyState
				size="narrow"
				icon="inbox"
				title="Noch keine Einträge"
				description="Hier stehen neue, verknüpfte und verworfene Einträge zusammen."
			/>
		{:else}
			<EmptyState
				size="narrow"
				icon="inbox"
				title="Keine verknüpften Einträge"
				description="Was du in ein Ticket umwandelst oder mit einem Ticket verknüpfst, steht danach hier mit einem Link zum Ticket."
			/>
		{/if}
	{:else if !ready}
		<p class="loading" role="status">Eingang wird geladen …</p>
	{/if}

	{#if phone && rows.length > 0}
		<!-- Cards instead of the table (MO-6): the same groups and order. -->
		<div class="card-list" {@attach rowMenus}>
			<p class="cards-caption" class:visually-hidden={showsNew && !grouped}>{caption}</p>
			{#each groups as group (group.key)}
				{#if grouped}
					{@const headId = `${uid}-group-${group.key}`}
					<section class="card-section" aria-labelledby={headId}>
						<h3 class="card-head" id={headId}>
							{group.label}<span class="group-count"
								>{group.items.length === 1 ? '1 Eintrag' : `${group.items.length} Einträge`}</span
							>
						</h3>
						<ol class="inbox-cards">
							{#each group.items as item (item.id)}
								{@render card(item)}
							{/each}
						</ol>
					</section>
				{:else}
					<ol class="inbox-cards" aria-label="Einträge">
						{#each group.items as item (item.id)}
							{@render card(item)}
						{/each}
					</ol>
				{/if}
			{/each}
		</div>
	{:else if rows.length > 0}
		<div class="frame" bind:this={frame}>
			<table {@attach rowMenus}>
				<caption id={ids.caption}
					>{caption}{#if columnFit.fit.autoHidden.length > 0}<span class="caption-more"
							>{MORE_COLUMNS_HINT}</span
						>{/if}</caption
				>
				<colgroup>
					{#each columnFit.shownColumns as column (column.id)}
						<col
							data-column={column.id}
							style:width={column.flexible ? undefined : `${columnFit.widthOf(column.id)}px`}
						/>
					{/each}
				</colgroup>
				<thead>
					<tr>
						{#each columnFit.shownColumns as column (column.id)}
							<ResizableHeader {column} fit={columnFit}>
								{#if column.id === 'select'}
									<input
										type="checkbox"
										aria-label="Alle angezeigten Einträge auswählen"
										checked={allChosen}
										disabled={selectable.length === 0}
										onchange={(event) => toggleAll(event.currentTarget.checked)}
									/>
								{:else if column.id === 'arrival'}
									{byArrival ? column.label : VIEW_LABELS[query.state]}
								{:else if column.id === 'actions'}
									<span class="visually-hidden">{column.label}</span>
								{:else}
									{column.label}
								{/if}
							</ResizableHeader>
						{/each}
					</tr>
				</thead>
				{#each groups as group (group.key)}
					<tbody>
						{#if grouped}
							<tr class="group-head">
								<th scope="rowgroup" colspan={columnFit.shownColumns.length}>
									{group.label}<span class="group-count"
										>{group.items.length === 1
											? '1 Eintrag'
											: `${group.items.length} Einträge`}</span
									>
								</th>
							</tr>
						{/if}
						{#each group.items as item (item.id)}
							{@render row(item)}
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}
	{#if !showsNew && store.handledLoad === 'ready' && (store.handledHasMore || store.loadingMoreHandled)}
		<!-- Below the table, so it stays reachable when every loaded row left the view. -->
		<button
			class="more"
			type="button"
			disabled={store.loadingMoreHandled}
			aria-busy={store.loadingMoreHandled ? 'true' : undefined}
			onclick={() => store.loadMoreHandled()}
		>
			{store.loadingMoreHandled ? 'Wird geladen …' : 'Weitere laden'}
		</button>
	{/if}
	{#if phone && (selecting || bulkBarShown)}
		<!-- The bar of "Auswählen" at the bottom, after the cards (MO-7b, shared with "Aufgaben");
		     outside of "Auswählen" a run of EG-1 or its result stands alone, as in the trash. -->
		{@render selectionBar(selecting)}
	{/if}
	{#if phone}
		<!-- The files after the list in the phone frame (MO-6): one level deeper, still there. -->
		<div class="cards-tools">{@render tools?.()}</div>
	{/if}
</section>

<!-- The filter sheet of the phone frame (MO-6); the modal gives the focus back to "Filter". -->
{#if phone && filtersOpen}
	<FilterSheet
		count={ready && !store.handledHasMore ? rows.length : null}
		{filtered}
		onreset={resetInSheet}
		onclose={() => (filtersOpen = false)}
		filters={sheetFilters}
		ticketOrder={false}
		noun={{ one: 'Eintrag', many: 'Einträge' }}
	/>
{/if}

<!-- "Anderem Ticket zuordnen …" of a row (AM-5), the dialog of the panel; the list is no modal. -->
{#if moving !== null && movingFrom !== null && sources !== null}
	<MoveSourceDialog
		item={{ id: moving.id, title: moving.title, scope: moving.scope }}
		current={movingFrom}
		store={sources}
		{picker}
		onclose={() => (moving = null)}
	/>
{/if}

<style>
	.inbox-table {
		min-width: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin-bottom: 0.75rem;
	}

	/* Filter "Zielprojekt" and the switch of the grouping (ADR-0049 §5), one block in the chips. */
	.target-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.group-switch {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-control);
	}

	/* Heading of a group of rows by target project. */
	.group-head th {
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text);
		background: var(--fill-control);
		border-bottom: 1px solid var(--color-line);
	}

	.group-count {
		margin-left: 0.5rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.capture {
		padding: 0.25rem 0.75rem;
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
		text-decoration: none;
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
	}

	.clipboard-hint {
		margin-bottom: 0.75rem;
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.bulk {
		padding: 0.25rem 0.75rem;
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
		background: var(--color-surface);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.bulk[aria-disabled='true'] {
		color: var(--color-text-muted);
		border-color: var(--color-line);
		cursor: not-allowed;
	}

	/* A bulk action of EG-1 runs. */
	.bulk[aria-busy='true'] {
		cursor: progress;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	/* The result of a bulk action of EG-1, as in the bars of "Aufgaben" and "Papierkorb". */
	.bulk-failures ul,
	.bulk-skipped {
		display: grid;
		gap: 0.125rem;
		margin-top: 0.25rem;
	}

	.result-title {
		font-weight: 600;
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

	thead :global(th) {
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.row {
		border-bottom: 1px solid var(--color-line);
	}

	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the open row: a bar at its start. A linked entry (ADR-0031,
	   addendum C) carries the same bar in the accent colour; its chip names the ticket. */
	.row.active > :first-child,
	.row.linked > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	/* "→ HAUS-12": the ticket of a linked entry as a chip in the accent colour, a link to it. */
	.ticket-chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		padding: 0.0625rem 0.5rem;
		overflow: hidden;
		font-size: var(--font-size-control);
		color: var(--color-brand-soft-text);
		white-space: nowrap;
		text-decoration: none;
		text-overflow: ellipsis;
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-pill);
	}

	.ticket-chip:hover {
		text-decoration: underline;
	}

	.ticket-key {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	/* Fixed widths: what does not fit is cut off inside its cell, never beside it. */
	td,
	.title {
		padding: 0.375rem 0.75rem;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		vertical-align: top;
	}

	.title {
		font-weight: 400;
	}

	/* Two lines at most (ADR-0030 section 6); the clamp is visual only. */
	.title-clamp {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.title-link {
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.duplicate {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		margin-top: 0.25rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.duplicate a {
		color: var(--color-brand-text);
	}

	.kind,
	.source,
	.target,
	.date {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.date {
		font-variant-numeric: tabular-nums;
	}

	.action-group {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		white-space: nowrap;
	}

	.action {
		padding: 0.125rem 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-text);
		text-decoration: none;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.action.primary {
		color: var(--color-brand-text);
		border-color: var(--color-brand);
	}

	.action:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* The row is being changed (ADR-0026, addendum of 2026-09-30). */
	.action[aria-busy='true'],
	.text-button[aria-busy='true'] {
		cursor: progress;
	}

	.more {
		margin-top: 0.75rem;
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-body);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.more:disabled {
		cursor: not-allowed;
	}

	.more[aria-busy='true'] {
		cursor: progress;
	}

	.loading {
		padding: 1.5rem 0;
		color: var(--color-text-muted);
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

	.text-button {
		padding: 0.125rem 0.5rem;
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	/*
	 * Phone frame (MO-6, ADR-0073 addendum MO-6): the cards in a framed list per group like the
	 * table, each a row of the box of the selection (while choosing), the body and "•••"; the title in
	 * up to three lines, long words, addresses and names wrap; the actions of a card, the bulk
	 * actions, "Dem Ticket … zuordnen", "Weitere laden" and the choices of the sheet are targets of
	 * 44 px. Off, or from 40rem, the table stays as it was.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .sync-status {
			margin: 0;
			font-size: var(--font-size-small);
			color: var(--color-text-muted);
		}

		:global(:root[data-mobile-layout='on']) .sync-status:not(:empty) {
			margin-bottom: 0.5rem;
		}

		:global(:root[data-mobile-layout='on']) .select-mode {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			align-items: center;
			margin-bottom: 0.75rem;
		}

		:global(:root[data-mobile-layout='on']) .select-all {
			display: inline-flex;
			gap: 0.5rem;
			align-items: center;
			padding-right: 0.5rem;
			font-size: var(--font-size-body);
		}

		:global(:root[data-mobile-layout='on']) .bulk,
		:global(:root[data-mobile-layout='on']) .more,
		:global(:root[data-mobile-layout='on']) .duplicate .text-button,
		:global(:root[data-mobile-layout='on']) .result-close {
			min-height: var(--control-height-touch);
		}

		/* "Nur mit Verbindung" (EG-1) takes the whole row of the actions in the bar at the bottom. */
		:global(:root[data-mobile-layout='on']) .offline-hint {
			grid-column: 1 / -1;
		}

		:global(:root[data-mobile-layout='on']) .sheet-filters {
			display: grid;
			gap: 1rem;
		}

		:global(:root[data-mobile-layout='on']) .sheet-filters :global(.toggle) {
			min-height: var(--control-height-touch);
		}

		:global(:root[data-mobile-layout='on']) .card-list {
			display: grid;
			gap: 0.75rem;
		}

		:global(:root[data-mobile-layout='on']) .cards-caption {
			margin: 0;
			font-size: var(--font-size-small);
			color: var(--color-text-muted);
		}

		:global(:root[data-mobile-layout='on']) .card-section {
			display: grid;
			gap: 0.375rem;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .card-head {
			margin: 0;
			font-size: var(--font-size-control);
			font-weight: 600;
		}

		:global(:root[data-mobile-layout='on']) .inbox-cards {
			min-width: 0;
			margin: 0;
			padding: 0;
			overflow: hidden;
			list-style: none;
			background: var(--color-surface);
			border: 1px solid var(--color-line);
			border-radius: var(--radius-surface);
		}

		:global(:root[data-mobile-layout='on']) .inbox-card {
			display: flex;
			gap: 0.25rem;
			align-items: flex-start;
			padding: 0.5rem 0.25rem 0.75rem 0.75rem;
			border-top: 1px solid var(--color-line);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .inbox-card:first-child {
			border-top: none;
		}

		:global(:root[data-mobile-layout='on']) .inbox-card.active,
		:global(:root[data-mobile-layout='on']) .inbox-card.chosen {
			background: var(--color-brand-soft-bg);
		}

		/* The open or linked entry: a bar at its start, not only a colour (as in the table). */
		:global(:root[data-mobile-layout='on']) .inbox-card.active,
		:global(:root[data-mobile-layout='on']) .inbox-card.linked {
			box-shadow: inset 3px 0 0 var(--color-brand);
		}

		:global(:root[data-mobile-layout='on']) .check-target {
			display: flex;
			flex: none;
			align-items: center;
			justify-content: center;
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
			margin-left: -0.5rem;
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .card-body {
			display: grid;
			flex: 1 1 auto;
			gap: 0.375rem;
			min-width: 0;
			padding-top: 0.625rem;
		}

		/* Up to three lines; the clamp is visual only, screen readers read the whole title. */
		:global(:root[data-mobile-layout='on']) .card-title {
			display: -webkit-box;
			margin: 0;
			overflow: hidden;
			font-size: var(--font-size-body);
			overflow-wrap: anywhere;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}

		:global(:root[data-mobile-layout='on']) .card-meta {
			display: flex;
			flex-wrap: wrap;
			gap: 0 0.75rem;
			min-width: 0;
			margin: 0;
			font-size: var(--font-size-control);
			color: var(--color-text-muted);
			overflow-wrap: anywhere;
		}

		:global(:root[data-mobile-layout='on']) .card-meta > span {
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .card-date {
			font-variant-numeric: tabular-nums;
		}

		:global(:root[data-mobile-layout='on']) .card-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			align-items: center;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .card-convert {
			color: var(--color-brand-text);
			border-color: var(--color-brand);
		}

		:global(:root[data-mobile-layout='on']) .card-actions .ticket-chip {
			min-height: var(--control-height-touch);
			padding-inline: 0.75rem;
		}

		:global(:root[data-mobile-layout='on']) .card-end {
			flex: none;
		}

		:global(:root[data-mobile-layout='on']) .cards-tools {
			margin-top: 1rem;
		}
	}
</style>
