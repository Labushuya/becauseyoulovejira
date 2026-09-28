<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import { personLabel } from '$lib/domain/people';
	import { clickRow, headState, toggleAll, type Selection } from '$lib/domain/selection';
	import type { ProjectRef } from '$lib/domain/ticket';
	import {
		daysLeftText,
		type RestoreNeed,
		type RestoreOptions,
		type TrashItem
	} from '$lib/domain/trash';
	import { TRASH_TABLE } from '$lib/domain/columns';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import TrashNeedQuestion from './TrashNeedQuestion.svelte';

	// Table "Papierkorb" (ADR-0037 §9): Auswahl, Key, Titel (link to the read-only preview), Projekt
	// (from the snapshot, "(gelöscht)" when it is gone), Gelöscht am, Von, the days until it is
	// deleted for good and the actions "Wiederherstellen" and "Endgültig löschen …". The selection
	// follows the rules of the ticket table (plan BI-2): Shift+click for a range, the head checkbox
	// for every row. A restore that needs a choice shows its question inline below the row. Like
	// every table it never scrolls sideways (ADR-0030); in a narrow frame Von, Gelöscht am, Projekt
	// and the days give way in this order.
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
		/** "Endgültig löschen …": the view asks before. */
		onpurge: (item: TrashItem) => void;
		ondismissneed: (id: string) => void;
		columnFit?: ColumnFit;
	} = $props();

	const CAPTION = 'Papierkorb · zuletzt gelöschte zuerst';
	const LONG_TITLE = 60;

	const shown = $derived(columnFit.shown);
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
</script>

<div class="frame" bind:this={frame}>
	<table>
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
					<td class="key" data-col="key">{item.key}</td>
					<th class="title" scope="row" data-col="title">
						<div class="title-clamp">
							<a
								class="title-link"
								href={hrefOf(item.id)}
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
						<td class="text" data-col="by">{personLabel(item.deletedBy, selfId)}</td>
					{/if}
					{#if shown.has('left')}
						<td class="date" data-col="left">{daysLeftText(item.daysLeft)}</td>
					{/if}
					<td class="actions" data-col="actions">
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
						<button
							class="button-icon"
							type="button"
							aria-label={`${item.key} endgültig löschen …`}
							title="Endgültig löschen …"
							aria-haspopup="dialog"
							aria-disabled={busy ? 'true' : undefined}
							onclick={() => {
								if (!busy) onpurge(item);
							}}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
								<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9" />
							</svg>
						</button>
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

	.date {
		font-variant-numeric: tabular-nums;
	}

	.actions {
		text-align: right;
		white-space: nowrap;
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
</style>
