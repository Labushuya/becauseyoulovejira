<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { isCardTap } from '$lib/card-tap';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import { personLabel } from '$lib/domain/people';
	import { clickRow, headState, toggleAll, type Selection } from '$lib/domain/selection';
	import type { ProjectRef } from '$lib/domain/ticket';
	import {
		purgeText,
		type RestoreNeed,
		type RestoreOptions,
		type TrashItem
	} from '$lib/domain/trash';
	import { blockedLabel, blockedName } from '$lib/domain/trash-dependencies';
	import { TRASH_TABLE, isKeyCut } from '$lib/domain/columns';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { findPeople } from '$lib/stores/people.svelte';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import StatusPill from './StatusPill.svelte';
	import { remPx } from './table/chip-measure';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import TrashNeedQuestion from './TrashNeedQuestion.svelte';

	// Table "Papierkorb" (ADR-0037 §9): Auswahl, Key, Titel (link to the read-only preview), Projekt
	// (from the snapshot, "(gelöscht)" when it is gone), Gelöscht am, Von, the days until it is
	// deleted for good and the actions: "Wiederherstellen" as a symbol, the frequent way, and the
	// menu "•••" of the row (plan aktionsmenues, AM-4) with "Vorschau öffnen", "Wiederherstellen"
	// and "Endgültig löschen …", which has no symbol of its own any more (rare and destructive, it
	// waits behind the menu instead of next to "Wiederherstellen"). A right click on a row or
	// Shift+F10 open the same menu (AM-3, rowMenus). The selection follows the rules of the ticket
	// table (plan BI-2): Shift+click for a range, the head checkbox for every row. A restore that
	// needs a choice shows its question inline below the row. Like every table it never scrolls
	// sideways (ADR-0030); in a narrow frame Von, Gelöscht am, Projekt, the days and the status give
	// way in this order. A ticket with dependencies (ADR-0047) shows "Blockiert (N)" next to its
	// status, waits for a decision instead of the retention, and its menu leads to the decision
	// help of the preview instead of "Endgültig löschen …".
	// Phone frame (MO-7b, ADR-0073 addendum MO-7b): with the choice "Handy-Ansicht: Automatisch" and
	// below 40rem the same component shows cards instead of the table, like the inbox (MO-6): the title
	// (up to three lines, the link to the preview), a muted line with key, status, "Blockiert (N)",
	// project, date, person, the days and the sub-tasks, "Wiederherstellen" with 44 px and "•••" with
	// the menu of the row. A tap on the card opens the preview, or chooses it while the view chooses
	// (`selecting`, "Auswählen"); the question of a restore stands below its card. Nothing of a column
	// goes: "Spalten" has no place without columns.
	let {
		items,
		selection,
		onselection,
		selfId,
		projects,
		hrefOf,
		activeId = null,
		needOf,
		isBusy,
		onrestore,
		onpurge,
		ondismissneed,
		selecting = false,
		columnFit = new ColumnFit(getColumnPrefs('trash'))
	}: {
		items: readonly TrashItem[];
		selection: Selection;
		onselection: (selection: Selection) => void;
		/** Signed-in user, for "Von" ("Du"). */
		selfId: string | null;
		/** Active projects, the targets of a restore that needs one. */
		projects: readonly ProjectRef[];
		/** Address of the preview of a ticket. */
		hrefOf: (id: string) => ResolvedPathname;
		/** Ticket shown in the preview; its row is marked. */
		activeId?: string | null;
		needOf: (id: string) => RestoreNeed | null;
		isBusy: (id: string) => boolean;
		onrestore: (id: string, options: RestoreOptions) => void;
		/**
		 * "Endgültig löschen …": the view asks before. Null without the right "purge" in a household
		 * (E7-3): the menu offers neither it nor the way to the decision help.
		 */
		onpurge: ((item: TrashItem) => void) | null;
		ondismissneed: (id: string) => void;
		/** The phone frame chooses ("Auswählen", MO-7b): a box on every card, a tap chooses. */
		selecting?: boolean;
		columnFit?: ColumnFit;
	} = $props();

	/** The phone frame (MO-7b): cards instead of the table. */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);

	const CAPTION = 'Papierkorb · zuletzt gelöschte zuerst';
	const LONG_TITLE = 60;
	// "Von" names another account where its name is visible (ADR-0056 §4).
	const people = findPeople();

	const shown = $derived(columnFit.shown);
	// A key cut off by a narrow column names itself in a title (KN-1).
	const rem = remPx();
	const keyWidth = $derived(columnFit.widthOf('key'));
	const order = $derived(items.map((item) => item.id));
	const head = $derived(headState(selection, order));
	const selectColumn = TRASH_TABLE.columns.find((column) => column.id === 'select');
	let frame = $state<HTMLElement>();
	let headBox = $state<HTMLInputElement>();
	/** Shift held on the last pointer or key press in a selection cell (a range). */
	let rangeHeld = false;

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

	$effect(() => {
		if (headBox) headBox.indeterminate = head === 'some';
	});

	function select(id: string, on: boolean) {
		const range = rangeHeld;
		rangeHeld = false;
		onselection(clickRow(selection, id, on, order, range));
	}

	/** A tap on a card opens the preview, or chooses the card while choosing (MO-7b). */
	function tapCard(event: MouseEvent, item: TrashItem) {
		if (!isCardTap(event)) return;
		if (selecting) select(item.id, !selection.ids.includes(item.id));
		else void goto(hrefOf(item.id));
	}

	/**
	 * The entries of the menu "•••" of a row (AM-4); a running restore locks them. A blocked ticket
	 * leads to its decision help instead of "Endgültig löschen …" (ADR-0047).
	 */
	function menuOf(item: TrashItem, busy: boolean): MenuAction[] {
		const actions: MenuAction[] = [
			{ label: 'Vorschau öffnen', href: hrefOf(item.id) },
			{
				label: 'Wiederherstellen',
				separated: true,
				busy,
				onselect: () => onrestore(item.id, {})
			}
		];
		const purge = onpurge;
		if (purge === null) return actions;
		actions.push(
			item.dependencies > 0
				? { label: 'Abhängigkeiten auflösen', separated: true, href: hrefOf(item.id) }
				: {
						label: 'Endgültig löschen …',
						dialog: true,
						separated: true,
						locked: busy,
						onselect: () => purge(item)
					}
		);
		return actions;
	}
</script>

{#if phone}
	<!-- Cards instead of the table (MO-7b): the same order, menus, links and questions. -->
	<ol class="trash-cards" aria-label="Tickets im Papierkorb" {@attach rowMenus}>
		{#each items as item (item.id)}
			{@const need = needOf(item.id)}
			{@const busy = isBusy(item.id)}
			{@const chosen = selection.ids.includes(item.id)}
			<!-- The title link is the keyboard target of the card; the tap on the card is a shortcut for it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<li
				class="trash-card"
				class:active={item.id === activeId}
				class:chosen={selecting && chosen}
				data-trash-row={item.id}
				data-menu-row
				aria-busy={busy ? 'true' : undefined}
				onclick={(event) => tapCard(event, item)}
			>
				{#if selecting}
					<!-- The whole target is the label: a tap anywhere in it chooses. -->
					<label class="check-target">
						<input
							type="checkbox"
							aria-label={`${item.key} auswählen`}
							checked={chosen}
							onchange={(event) => select(item.id, event.currentTarget.checked)}
						/>
					</label>
				{/if}
				<div class="card-body">
					<!-- Up to three lines, cut off only visually; screen readers read the whole title. -->
					<p class="card-title">
						<a
							class="title-link"
							href={hrefOf(item.id)}
							data-row-link
							title={item.title.length >= LONG_TITLE ? item.title : undefined}
							aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
						>
					</p>
					<p class="card-meta">
						<span class="key">{item.key}</span>
						<span class="status-group">
							<StatusPill status={item.status} />
							{#if item.dependencies > 0}
								<span title={blockedName(item.dependencies)}>
									<Lozenge label={blockedLabel(item.dependencies)} icon="warning" />
								</span>
							{/if}
						</span>
						{#if item.project !== null}
							<span
								>{item.project.name || item.project.code} ({item.project
									.code}){#if !item.project.exists}, gelöscht oder geändert{/if}</span
							>
						{/if}
						<span class="card-date">Gelöscht {formatBerlinDateTime(item.deletedAt)}</span>
						<span>von {personLabel(item.deletedBy, selfId, people)}</span>
						<span>{purgeText(item.daysLeft, item.dependencies)}</span>
						{#if item.children > 0}
							<span
								>mit {item.children === 1
									? '1 Unteraufgabe'
									: `${item.children} Unteraufgaben`}</span
							>
						{/if}
					</p>
					<div class="card-actions">
						<button
							class="button-secondary"
							type="button"
							aria-disabled={busy ? 'true' : undefined}
							aria-busy={busy ? 'true' : undefined}
							onclick={() => {
								if (!busy) onrestore(item.id, {});
							}}
						>
							Wiederherstellen<span class="visually-hidden">: {item.key}</span>
						</button>
					</div>
				</div>
				<div class="card-end">
					<ActionsMenu
						label={`Weitere Aktionen für ${item.key}`}
						buttonLabel={`Weitere Aktionen für ${item.key}`}
						buttonTitle="Weitere Aktionen"
						buttonClass="button-icon row-menu"
						items={menuOf(item, busy)}
					/>
				</div>
			</li>
			{#if need}
				<li class="need-card" data-need-for={item.id}>
					<TrashNeedQuestion
						key={item.key}
						{need}
						{projects}
						{busy}
						onrestore={(options) => onrestore(item.id, options)}
						oncancel={() => ondismissneed(item.id)}
					/>
				</li>
			{/if}
		{/each}
	</ol>
{:else}
	<div class="frame" bind:this={frame}>
		<table {@attach rowMenus}>
			<caption
				>{CAPTION}{#if columnFit.fit.autoHidden.length > 0}<span class="caption-more"
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
						{#if column.id === 'select' && selectColumn}
							<ResizableHeader column={selectColumn} fit={columnFit} className="select-head">
								<input
									type="checkbox"
									aria-label="Alle Tickets im Papierkorb auswählen"
									checked={head === 'all'}
									disabled={items.length === 0}
									bind:this={headBox}
									onchange={() => onselection(toggleAll(selection, order))}
								/>
							</ResizableHeader>
						{:else}
							<ResizableHeader {column} fit={columnFit}>
								{#if column.id === 'actions'}
									<span class="visually-hidden">{column.label}</span>
								{:else}
									{column.label}
								{/if}
							</ResizableHeader>
						{/if}
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each items as item (item.id)}
					{@const need = needOf(item.id)}
					{@const busy = isBusy(item.id)}
					{@const chosen = selection.ids.includes(item.id)}
					<tr
						class="row"
						class:active={item.id === activeId}
						class:selected={chosen}
						data-trash-row={item.id}
						aria-busy={busy ? 'true' : undefined}
					>
						<td
							class="select"
							data-col="select"
							onpointerdown={(event) => (rangeHeld = event.shiftKey)}
						>
							<label class="select-hit">
								<input
									type="checkbox"
									aria-label={`${item.key} auswählen`}
									checked={chosen}
									onkeydown={(event) => (rangeHeld = event.shiftKey)}
									onchange={(event) => select(item.id, event.currentTarget.checked)}
								/>
							</label>
						</td>
						<td
							class="key"
							data-col="key"
							title={isKeyCut(item.key, keyWidth, false, rem) ? item.key : undefined}>{item.key}</td
						>
						<th class="title" scope="row" data-col="title">
							<div class="title-clamp">
								<a
									class="title-link"
									href={hrefOf(item.id)}
									data-row-link
									title={item.title.length >= LONG_TITLE ? item.title : undefined}
									aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
								>
							</div>
							{#if item.children > 0}
								<span class="children"
									>mit {item.children === 1
										? '1 Unteraufgabe'
										: `${item.children} Unteraufgaben`}</span
								>
							{/if}
						</th>
						{#if shown.has('status')}
							<td class="status" data-col="status">
								<span class="status-group">
									<StatusPill status={item.status} />
									{#if item.dependencies > 0}
										<span title={blockedName(item.dependencies)}>
											<Lozenge label={blockedLabel(item.dependencies)} icon="warning" />
										</span>
									{/if}
								</span>
							</td>
						{/if}
						{#if shown.has('project')}
							<td class="text" data-col="project">
								{#if item.project === null}
									<span aria-hidden="true">–</span><span class="visually-hidden">kein Projekt</span>
								{:else}
									{item.project.name || item.project.code}
									<span class="code">({item.project.code})</span>
									{#if !item.project.exists}<span class="gone">gelöscht oder geändert</span>{/if}
								{/if}
							</td>
						{/if}
						{#if shown.has('deleted')}
							<td class="date" data-col="deleted">{formatBerlinDateTime(item.deletedAt)}</td>
						{/if}
						{#if shown.has('by')}
							<td class="text" data-col="by">{personLabel(item.deletedBy, selfId, people)}</td>
						{/if}
						{#if shown.has('left')}
							<td class="date" data-col="left">{purgeText(item.daysLeft, item.dependencies)}</td>
						{/if}
						<td class="actions" data-col="actions">
							<span class="action-group">
								<button
									class="button-icon"
									type="button"
									aria-label={`${item.key} wiederherstellen`}
									title="Wiederherstellen"
									aria-disabled={busy ? 'true' : undefined}
									onclick={() => {
										if (!busy) onrestore(item.id, {});
									}}
								>
									<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M3 8a5 5 0 1 0 1.46-3.54M3 2.75v2.5h2.5" />
									</svg>
								</button>
								<ActionsMenu
									label={`Weitere Aktionen für ${item.key}`}
									buttonLabel={`Weitere Aktionen für ${item.key}`}
									buttonTitle="Weitere Aktionen"
									buttonClass="button-icon row-menu"
									items={menuOf(item, busy)}
								/>
							</span>
						</td>
					</tr>
					{#if need}
						<tr class="need-row" data-need-for={item.id}>
							<td colspan={columnFit.shownColumns.length}>
								<TrashNeedQuestion
									key={item.key}
									{need}
									{projects}
									{busy}
									onrestore={(options) => onrestore(item.id, options)}
									oncancel={() => ondismissneed(item.id)}
								/>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	/* The measured frame of fitColumns (ADR-0030); the table takes its width and never more. */
	.frame {
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	table {
		width: 100%;
		table-layout: fixed;
		font-size: var(--font-size-body);
		border-collapse: collapse;
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.caption-more {
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

	/* Head checkbox of the selection, centred above the boxes of the rows. */
	thead :global(th.select-head) {
		padding: 0;
		text-align: center;
	}

	.row,
	.need-row {
		border-bottom: 1px solid var(--color-line);
	}

	.row.selected,
	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the chosen or open row: a bar at its start. */
	.row.selected > :first-child,
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	td,
	.title {
		padding: 0.375rem 0.75rem;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		vertical-align: middle;
	}

	.need-row td {
		padding: 0.5rem 0.75rem 0.75rem;
		overflow: visible;
	}

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

	.key,
	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		white-space: nowrap;
	}

	.title {
		font-weight: 400;
	}

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

	.children,
	.gone {
		display: block;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.text,
	.date {
		font-size: var(--font-size-control);
		white-space: nowrap;
	}

	.status-group {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}

	.date {
		font-variant-numeric: tabular-nums;
	}

	/*
	 * "Wiederherstellen" and the menu "•••" in the 5rem of the column (ADR-0030, Nachtrag 5): a
	 * narrower padding, the menu at the small control height of base.css (`.row-menu`).
	 */
	.actions {
		padding-inline: 0.5rem;
		text-align: right;
		white-space: nowrap;
	}

	.action-group {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
	}

	.actions svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/*
	 * Phone frame (MO-7b, ADR-0073 addendum MO-7b): the cards in a framed list like the table, each a
	 * row of the box of the selection (while choosing), the body and "•••"; the title in up to three
	 * lines, long words wrap; "Wiederherstellen" and the box are targets of 44 px. Off, or from 40rem,
	 * the table stays as it was.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .trash-cards {
			min-width: 0;
			margin: 0;
			padding: 0;
			overflow: hidden;
			list-style: none;
			background: var(--color-surface);
			border: 1px solid var(--color-line);
			border-radius: var(--radius-surface);
		}

		:global(:root[data-mobile-layout='on']) .trash-card {
			display: flex;
			gap: 0.25rem;
			align-items: flex-start;
			padding: 0.5rem 0.25rem 0.75rem 0.75rem;
			border-top: 1px solid var(--color-line);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .trash-card:first-child {
			border-top: none;
		}

		:global(:root[data-mobile-layout='on']) .trash-card.active,
		:global(:root[data-mobile-layout='on']) .trash-card.chosen {
			background: var(--color-brand-soft-bg);
		}

		/* The open or chosen ticket: a bar at its start, not only a colour (as in the table). */
		:global(:root[data-mobile-layout='on']) .trash-card.active,
		:global(:root[data-mobile-layout='on']) .trash-card.chosen {
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
			gap: 0.125rem 0.75rem;
			align-items: center;
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
		}

		:global(:root[data-mobile-layout='on']) .card-end {
			flex: none;
		}

		:global(:root[data-mobile-layout='on']) .need-card {
			padding: 0.5rem 0.75rem 0.75rem;
			border-top: 1px solid var(--color-line);
		}
	}
</style>
