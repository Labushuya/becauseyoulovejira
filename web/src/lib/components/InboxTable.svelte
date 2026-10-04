<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { areaMover } from '$lib/area-move-entry';
	import { INBOX_TABLE } from '$lib/domain/columns';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import {
		CHANNEL_LABELS,
		KIND_LABELS,
		VIEW_LABELS,
		type InboxItemSummary,
		type InboxView
	} from '$lib/domain/inbox';
	import { type InboxQuery } from '$lib/domain/inbox-query';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import type { Project } from '$lib/domain/project';
	import { projectChoiceLabel, treeOrder } from '$lib/domain/project-tree';
	import { SOURCE_FAMILY_CHIPS, SOURCE_FAMILY_LABELS, type SourceFamily } from '$lib/domain/source';
	import { canLeaveTicket, canSavePage, isMainSource } from '$lib/domain/sources';
	import {
		NO_TARGET,
		TARGET_LABEL,
		groupByTarget,
		targetOfItem,
		targetText
	} from '$lib/domain/target-project';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { INBOX_UNAVAILABLE_MESSAGE, type InboxStore } from '$lib/stores/inbox.svelte';
	import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { captureHref, convertHref, inboxItemHref, withInboxQuery } from '$lib/ticket-links';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';
	import ChipGroup from './ChipGroup.svelte';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import FilterPopover from './FilterPopover.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MoveSourceDialog from './MoveSourceDialog.svelte';
	import SectionBar from './SectionBar.svelte';
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
		bulkHint: `${uid}-bulk-hint`
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
	/** Chosen entries that are shown and still new (a converted or discarded one drops out). */
	const chosen = $derived(
		rows.filter((item) => item.state === 'new' && selected.includes(item.id))
	);
	const selectable = $derived(rows.filter((item) => item.state === 'new'));
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

	// Columns (ADR-0030): the selection exists only for new entries, the target project only once the
	// server knows it (ADR-0049).
	const columnFit = new ColumnFit(getColumnPrefs('inbox'), () =>
		INBOX_TABLE.columns.filter(
			(column) => (showsNew || column.id !== 'select') && (targetsReady || column.id !== 'target')
		)
	);
	const shown = $derived(columnFit.shown);
	let frame = $state<HTMLElement>();

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

	/** Failure of a row action (discard, restore, assign) as an error flag; it stays until closed. */
	function fail(message: string | null | undefined) {
		if (message) flags.show({ tone: 'error', title: message });
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

	function titleLinks(): HTMLElement[] {
		return [...(root?.querySelectorAll<HTMLElement>('tbody tr[data-item-id] a.title-link') ?? [])];
	}

	/** Position of the row of an entry among the rows, -1 without one. */
	function rowIndex(id: string): number {
		return titleLinks().findIndex((link) => link.closest('tr')?.dataset.itemId === id);
	}

	/** The row of an entry left: the focus goes to the row at its place, else the last, else the heading. */
	async function focusNear(id: string, index: number) {
		await tick();
		const links = titleLinks().filter((link) => link.closest('tr')?.dataset.itemId !== id);
		const next = links[Math.min(index, links.length - 1)];
		(next ?? heading)?.focus();
	}

	/** After "Verwerfen" the focus goes to the next row, else the previous one, else the heading. */
	async function discard(item: InboxItemSummary) {
		const index = rowIndex(item.id);
		const result = await store.discard(item.id);
		if (!result.ok) {
			fail(result.message);
			return;
		}
		selected = selected.filter((entry) => entry !== item.id);
		await focusNear(item.id, index);
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
				fail(`Seite von „${item.title}“ ließ sich nicht sichern: ${result.message}`);
			}
		} finally {
			saving = null;
		}
	}

	async function act(action: () => Promise<{ ok: boolean; message?: string | null }>) {
		const result = await action();
		if (!result.ok) fail(result.message);
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
			else fail(result.message);
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
			const link = titleLinks().find((entry) => entry.closest('tr')?.dataset.itemId === previous);
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
				<input
					type="checkbox"
					aria-label={`Eintrag „${item.title}“ auswählen`}
					checked={selected.includes(item.id)}
					onchange={(event) => toggle(item.id, event.currentTarget.checked)}
				/>
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
				>
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
				{#if item.state === 'new'}
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
				<ActionsMenu
					label={`Weitere Aktionen für „${item.title}“`}
					buttonLabel={`Weitere Aktionen für „${item.title}“`}
					buttonTitle="Weitere Aktionen"
					buttonClass="button-icon row-menu"
					items={menuOf(item, linkedTicket?.key ?? null)}
				/>
			</span>
		</td>
	</tr>
{/snippet}

<section class="inbox-table" aria-labelledby={ids.heading} bind:this={root}>
	<SectionBar
		title="Eingang"
		headingId={ids.heading}
		count={ready ? `${rows.length}${store.handledHasMore ? '+' : ''}` : null}
		{countLabel}
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
			{#if showsNew}
				<button
					class="bulk"
					type="button"
					aria-disabled={chosen.length === 0 ? 'true' : undefined}
					aria-describedby={chosen.length === 0 ? ids.bulkHint : undefined}
					onclick={() => {
						if (chosen.length > 0) onbulk();
					}}
				>
					Gesammelt umwandeln{chosen.length > 0 ? ` (${chosen.length})` : ''}
				</button>
				{#if onlink}
					<button
						class="bulk"
						type="button"
						aria-disabled={chosen.length === 0 ? 'true' : undefined}
						aria-describedby={chosen.length === 0 ? ids.bulkHint : undefined}
						onclick={() => {
							if (chosen.length > 0) onlink();
						}}
					>
						Mit Ticket verknüpfen …{chosen.length > 0 ? ` (${chosen.length})` : ''}
					</button>
				{/if}
				{#if chosen.length === 0}
					<span class="hint" id={ids.bulkHint}>Erst Einträge auswählen.</span>
				{/if}
			{/if}
			<ColumnsPopover fit={columnFit} always="Auswahl, Titel und Aktionen sind immer sichtbar." />
		{/snippet}
	</SectionBar>

	<div class="chips">
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
	</div>

	{@render tools?.()}

	<div role="status">
		{#if clipboardHint}
			<p class="clipboard-hint">{clipboardHint}</p>
		{/if}
	</div>

	{#snippet failure(message: string)}
		<SectionMessage tone="error" live>
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
			{@render failure(store.error)}
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

	{#if rows.length > 0}
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
</section>

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

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
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
</style>
