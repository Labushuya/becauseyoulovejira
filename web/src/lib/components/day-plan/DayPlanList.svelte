<script lang="ts" module>
	/** Types of the data a drag carries (ADR-0065 §4): an entry of the plan or a ticket of the pool. */
	export const DRAG_ITEM = 'application/x-byl-dayplan-item';
	export const DRAG_TICKET = 'application/x-byl-ticket';

	/** Whether a drag carries an entry or a ticket this list takes. */
	export function carriesPlanData(types: readonly string[] | DOMStringList | undefined): boolean {
		return carries(types, DRAG_ITEM) || carries(types, DRAG_TICKET);
	}

	/** Whether a drag carries data of this type. */
	export function carries(
		types: readonly string[] | DOMStringList | undefined,
		type: string
	): boolean {
		return types !== undefined && [...(types as Iterable<string>)].includes(type);
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { SOURCE_LABELS, initialsOf, type DayPlanSource } from '$lib/domain/day-plan';
	import { personLabel } from '$lib/domain/people';
	import { auth } from '$lib/auth.svelte';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import type { DayPlanStore, PlanRow } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { findPeople } from '$lib/stores/people.svelte';
	import { findAssignees } from '$lib/stores/assignees.svelte';
	import ActionsMenu, { type MenuAction } from '../ActionsMenu.svelte';
	import AssigneeBadge from '../AssigneeBadge.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import KindBadge from '../KindBadge.svelte';
	import SubtaskNestIcon from '../SubtaskNestIcon.svelte';
	import SubtaskPath from '../SubtaskPath.svelte';
	import SubtaskProgressChip from '../SubtaskProgressChip.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import PendingMark from '../offline/PendingMark.svelte';

	// The entries of a day plan (ADR-0065 §4): a list in the order of the plan, which only the user
	// changes. Each entry has its check mark (a task is completed, an ongoing project checked for the
	// day; ADR-0065 §2), the charm, key and title as a link that opens the ticket next to the plan, the
	// chip "2/5" at a parent (TP-3), the badge "Vorhaben", in a household
	// the initials of who added and checked it (names in the tooltip and for screen readers), and the
	// menu with the other way of checking, "Auf morgen schieben", the kind and "Entfernen". The order
	// changes by dragging an entry at its handle, by "Nach oben" and "Nach unten" and by Alt+arrow
	// anywhere in the entry; a ticket of the pool can be dropped at a place. Days before are read-only:
	// no check mark to change, no handle, no menu. In a household the initials of the assignee of the
	// ticket follow its badge (ADR-0068 §8). A sub-task stands indented with the corner of the table
	// when the entry directly above it is its parent or an indented sibling (TP-3, only display: the
	// order stays); otherwise it names its parent above its title, the key a link as well (TP-2). A
	// parent moves with this block (TP-4): dragged, all of it is dragged; "nach oben", "nach unten"
	// and Alt+arrow take it past the whole neighbour. A sub-task moves alone and may leave its block.
	// Sorted (TP-5) the list shows the order of the sort (store.shown, a parent with its sub-tasks as a
	// unit, done entries last) and moves nothing: no handle, no "nach oben"/"nach unten", no Alt+arrow;
	// the hint of the sort describes the list. A ticket of the pool dropped on a sorted plan comes in
	// without a place, the server puts it (TP-4) and the sort shows it.
	// In the phone frame (MO-2, ADR-0073 addendum MO-2) an entry is "Haken · Titel · •••": the check
	// mark in a target of 44 px (its label), the title in the rest of the row, the initials below it,
	// and "Nach oben"/"Nach unten" move from the row into "•••" (one level deeper, with the same steps
	// and the same announcement); no handle, dragging is no way on a phone. Alt+arrow stays.
	// A check mark the outbox keeps for later (OF-3) shows as kept (the overlay of the store) and
	// carries the mark "Noch nicht übertragen" after the key.
	let {
		store,
		household = false,
		describedby,
		onfinish
	}: {
		store: DayPlanStore;
		/** The plan of a household: who added and who checked an entry shows as initials. */
		household?: boolean;
		/** ID of the hint of a sorted plan (TP-5), the description of the list. */
		describedby?: string;
		/** "Vorhaben abschließen …": the view asks first. */
		onfinish: (row: PlanRow) => void;
	} = $props();

	const links = ticketLinks();
	const people = findPeople();
	/** The initials of the assignee of an entry (ADR-0068 §8). */
	const assignees = findAssignees();

	let list = $state<HTMLOListElement>();
	/** The place a drag would drop at (before the entry with this index), null without a drag. */
	let dropIndex = $state<number | null>(null);
	/** The entry being dragged. */
	let dragging = $state<string | null>(null);
	/** A ticket of the pool over a sorted plan (TP-5): it comes in without a place. */
	let dropAnywhere = $state(false);

	/**
	 * The entries in the order shown, each indented below its parent or not: in "Manuell" the order of
	 * the plan (TP-3), sorted the order of the sort (TP-5).
	 */
	const shown = $derived(store.shown);
	const sorted = $derived(store.sorted);
	/** The entries that move with the dragged one (TP-4): a parent with its block. */
	const draggedBlock = $derived(dragging === null ? [] : store.blockOf(dragging));
	const editable = $derived(store.editable);
	/** Only the manual order changes (TP-5, S3). */
	const movable = $derived(editable && !sorted);
	/** The phone frame (MO-2): moving through "•••" instead of the buttons and the handle. */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);

	/** Whether an entry, a parent with its block (TP-4), stands at the bottom of the plan. */
	function atBottom(row: PlanRow, index: number): boolean {
		return index + store.blockOf(row.item.id).length >= shown.length;
	}

	function keyOf(row: PlanRow): string {
		return row.ticket?.key ?? 'Eintrag';
	}

	function checkLabel(row: PlanRow): string {
		return row.kind === 'ongoing' ? `${keyOf(row)} für heute erledigt` : `${keyOf(row)} erledigt`;
	}

	function nameOf(userId: string): string {
		return personLabel(userId, auth.userId, people);
	}

	/** Who added and who checked an entry, for the tooltip and screen readers. */
	function whoText(row: PlanRow): string {
		const parts: string[] = [];
		if (row.item.addedBy !== '') parts.push(`Hinzugefügt von ${nameOf(row.item.addedBy)}`);
		else if (row.item.origin !== 'manual') {
			parts.push(`Automatisch übernommen (${SOURCE_LABELS[row.item.origin as DayPlanSource]})`);
		}
		if (row.done && row.item.checkedBy !== '')
			parts.push(`abgehakt von ${nameOf(row.item.checkedBy)}`);
		return parts.join(', ');
	}

	function initialsText(row: PlanRow): string {
		const added = row.item.addedBy === '' ? '' : initialsOf(nameOf(row.item.addedBy));
		const checked =
			row.done && row.item.checkedBy !== '' ? initialsOf(nameOf(row.item.checkedBy)) : '';
		if (added !== '' && checked !== '' && checked !== added) return `${added} · ✓ ${checked}`;
		if (checked !== '') return `✓ ${checked}`;
		return added;
	}

	function menuOf(row: PlanRow, index: number): MenuAction[] {
		const id = row.item.id;
		const ticket = row.ticket;
		const items: MenuAction[] = [];
		const pending = store.isPending(id);
		if (row.kind === 'task' && !row.done) {
			items.push({ label: 'Nur für heute abhaken', onselect: () => void store.checkToday(id) });
		}
		if (row.kind === 'ongoing' && ticket !== null && ticket.status !== 'done') {
			items.push({ label: 'Vorhaben abschließen …', dialog: true, onselect: () => onfinish(row) });
		}
		if (store.isToday) {
			items.push({ label: 'Auf morgen schieben', onselect: () => void store.moveToTomorrow(id) });
		}
		if (ticket !== null) {
			items.push(
				row.kind === 'ongoing'
					? {
							label: 'Als Aufgabe markieren',
							onselect: () => void store.setKind(ticket.id, 'task')
						}
					: {
							label: 'Als laufendes Vorhaben markieren',
							onselect: () => void store.setKind(ticket.id, 'ongoing')
						}
			);
		}
		if (phone && movable) {
			// The buttons of the row, one level deeper in the frame (MO-2); locked like them.
			items.push(
				{
					label: 'Nach oben',
					separated: true,
					locked: index === 0 || pending,
					onselect: () => void move(row, -1)
				},
				{
					label: 'Nach unten',
					locked: atBottom(row, index) || pending,
					onselect: () => void move(row, 1)
				}
			);
		}
		items.push({ label: 'Entfernen', separated: true, onselect: () => void store.remove(id) });
		return items;
	}

	function onCheckClick(event: MouseEvent, row: PlanRow) {
		if (!editable || store.isPending(row.item.id)) event.preventDefault();
	}

	function onCheckChange(event: Event & { currentTarget: HTMLInputElement }, row: PlanRow) {
		const input = event.currentTarget;
		void store.toggle(row.item.id);
		input.checked = row.done;
	}

	/** Moves an entry and keeps the focus on the control that had it. */
	async function move(row: PlanRow, direction: -1 | 1) {
		const active = document.activeElement;
		const done =
			direction < 0 ? await store.moveUp(row.item.id) : await store.moveDown(row.item.id);
		if (!done) return;
		await tick();
		if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active) {
			active.focus();
		}
	}

	function onRowKeydown(event: KeyboardEvent, row: PlanRow) {
		if (!movable || !event.altKey || event.defaultPrevented) return;
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		if (event.target instanceof Element && event.target.closest('[popover]') !== null) return;
		event.preventDefault();
		void move(row, event.key === 'ArrowUp' ? -1 : 1);
	}

	// --- Dragging (native, ADR-0065 §4) -----------------------------------------------------------

	function onDragStart(event: DragEvent, row: PlanRow) {
		if (!movable || event.dataTransfer === null) return;
		event.dataTransfer.setData(DRAG_ITEM, row.item.id);
		event.dataTransfer.effectAllowed = 'move';
		const entry = (event.currentTarget as HTMLElement).closest('li');
		if (entry !== null) event.dataTransfer.setDragImage(entry, 16, 16);
		dragging = row.item.id;
	}

	function onDragEnd() {
		dragging = null;
		dropIndex = null;
		dropAnywhere = false;
	}

	/** The place before which a drop at `clientY` goes: the first entry whose middle is below it. */
	function indexAt(clientY: number): number {
		const entries = [...(list?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])];
		const index = entries.findIndex((entry) => {
			const box = entry.getBoundingClientRect();
			return clientY < box.top + box.height / 2;
		});
		return index === -1 ? entries.length : index;
	}

	function onDragOver(event: DragEvent) {
		const types = event.dataTransfer?.types;
		if (!editable || !carriesPlanData(types)) return;
		// Sorted, only a ticket of the pool comes in, without a place (TP-5).
		if (sorted && !carries(types, DRAG_TICKET)) return;
		event.preventDefault();
		if (event.dataTransfer !== null) {
			event.dataTransfer.dropEffect = dragging !== null ? 'move' : 'copy';
		}
		if (sorted) dropAnywhere = true;
		else dropIndex = indexAt(event.clientY);
	}

	function onDragLeave(event: DragEvent) {
		const next = event.relatedTarget;
		if (
			next instanceof Node &&
			event.currentTarget instanceof Node &&
			event.currentTarget.contains(next)
		)
			return;
		dropIndex = null;
		dropAnywhere = false;
	}

	function onDrop(event: DragEvent) {
		if (!editable || event.dataTransfer === null) return;
		const itemId = sorted ? '' : event.dataTransfer.getData(DRAG_ITEM);
		const ticketId = event.dataTransfer.getData(DRAG_TICKET);
		if (itemId === '' && ticketId === '') return;
		event.preventDefault();
		const index = dropIndex ?? indexAt(event.clientY);
		dropIndex = null;
		dropAnywhere = false;
		dragging = null;
		if (itemId !== '') {
			void store.drop(itemId, index);
		} else if (sorted) {
			void store.add(ticketId);
		} else {
			void store.add(ticketId, index);
		}
	}
</script>

<div
	class="plan"
	class:drop-target={dropAnywhere}
	role="group"
	aria-label="Einträge des Plans"
	aria-describedby={describedby}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	{#if shown.length === 0}
		<div class="drop-zone" class:drop-target={dropIndex !== null}>
			<EmptyState
				size="compact"
				title={editable ? 'Noch nichts geplant' : 'Kein Eintrag an diesem Tag'}
				description={editable
					? phone
						? 'Vorschläge übernehmen oder unter „Hinzufügen …“ mit „+“ aufnehmen.'
						: 'Vorschläge übernehmen, im Pool mit „+“ aufnehmen oder ein Ticket hierher ziehen.'
					: undefined}
			/>
		</div>
	{:else}
		<ol class="entries" bind:this={list}>
			{#each shown as { entry: row, nested }, index (row.item.id)}
				{@const ticket = row.ticket}
				{@const key = keyOf(row)}
				{@const pending = store.isPending(row.item.id)}
				<!-- Alt+arrow anywhere in the entry moves it; the keys come from its own controls. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<li
					class="entry"
					class:nested
					class:done={row.done}
					class:dragging={draggedBlock.includes(row.item.id)}
					class:drop-before={dropIndex === index}
					class:drop-after={dropIndex === shown.length && index === shown.length - 1}
					data-item-id={row.item.id}
					aria-busy={pending ? 'true' : undefined}
					onkeydown={(event) => onRowKeydown(event, row)}
				>
					{#if movable && !phone}
						<span
							class="handle"
							draggable="true"
							title="Ziehen, um die Reihenfolge zu ändern"
							aria-hidden="true"
							ondragstart={(event) => onDragStart(event, row)}
							ondragend={onDragEnd}
						>
							<svg viewBox="0 0 16 16" focusable="false">
								<circle cx="6" cy="4" r="1" /><circle cx="10" cy="4" r="1" />
								<circle cx="6" cy="8" r="1" /><circle cx="10" cy="8" r="1" />
								<circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" />
							</svg>
						</span>
					{/if}
					{#snippet check()}
						<input
							class="check"
							type="checkbox"
							aria-label={checkLabel(row)}
							checked={row.done}
							disabled={!editable}
							aria-disabled={pending ? 'true' : undefined}
							onclick={(event) => onCheckClick(event, row)}
							onchange={(event) => onCheckChange(event, row)}
						/>
					{/snippet}
					{#if phone}
						<!-- A tap anywhere in the target of 44 px checks (MO-2); the name stays the box's. -->
						<label class="check-target">{@render check()}</label>
					{:else}
						{@render check()}
					{/if}
					<span class="title-cell">
						{#if ticket !== null}
							{@const parent = store.parentOf(ticket)}
							{#if parent && nested}
								<!-- Directly below its parent (TP-3): the corner, the parent only for screen readers. -->
								<SubtaskPath {parent} path={false} />
								<SubtaskNestIcon />
							{:else if parent}
								<!-- A sub-task names its parent above its title (TP-2). -->
								<SubtaskPath {parent} withTitle href={links.href(parent.id, page.url)} />
							{/if}
							<CharmIcon charm={ticket.charm} />
							<!-- A check mark kept by the outbox (OF-3) marks its entry. -->
							<span class="key">{ticket.key}<PendingMark id={row.item.id} /></span>
							<a
								class="title-link"
								href={links.href(ticket.id, page.url)}
								data-ticket-link={ticket.id}>{ticket.title}</a
							>
							<KindBadge kind={row.kind} />
							{#if household && assignees && ticket.assignee}
								<!-- The initials of the assignee in the shared plan (ADR-0068 §8). -->
								<AssigneeBadge assignee={ticket.assignee} context={assignees.context} />
							{/if}
							<SubtaskProgressChip progress={store.progressOf(ticket.id)} />
						{:else}
							<span class="missing">Ticket nicht sichtbar</span>
						{/if}
					</span>
					{#if household && initialsText(row) !== ''}
						<span class="people" title={whoText(row)}>
							<span aria-hidden="true">{initialsText(row)}</span>
							<span class="visually-hidden">{whoText(row)}</span>
						</span>
					{:else if !household && row.item.addedBy === '' && row.item.origin !== 'manual'}
						<span class="visually-hidden">{whoText(row)}</span>
					{/if}
					{#if editable}
						<span class="actions">
							{#if movable && !phone}
								<button
									class="button-icon"
									type="button"
									data-move="up"
									aria-label={`${key} nach oben`}
									title="Nach oben (Alt+Pfeil hoch)"
									aria-keyshortcuts="Alt+ArrowUp"
									aria-disabled={index === 0 || pending ? 'true' : undefined}
									onclick={() => void move(row, -1)}
								>
									<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M8 12.5v-9M4 7l4-4 4 4" />
									</svg>
								</button>
								<button
									class="button-icon"
									type="button"
									data-move="down"
									aria-label={`${key} nach unten`}
									title="Nach unten (Alt+Pfeil runter)"
									aria-keyshortcuts="Alt+ArrowDown"
									aria-disabled={atBottom(row, index) || pending ? 'true' : undefined}
									onclick={() => void move(row, 1)}
								>
									<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M8 3.5v9M4 9l4 4 4-4" />
									</svg>
								</button>
							{/if}
							<ActionsMenu
								label={`Aktionen für ${key}`}
								buttonLabel={`Weitere Aktionen für ${key}`}
								buttonTitle="Weitere Aktionen"
								items={menuOf(row, index)}
							/>
						</span>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.plan {
		min-width: 0;
	}

	/* One column never wider than the plan, also with indented entries (TP-3). */
	.entries {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		min-height: var(--control-height-m);
		padding: 0.25rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	/* A sub-task directly below its parent (TP-3): the whole entry indented, like in the pool. */
	.entry.nested {
		margin-left: 1.5rem;
	}

	.entry.done .title-link,
	.entry.done .key {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	.entry.dragging {
		opacity: 0.5;
	}

	/* Where a drag would drop: a line of the brand before or after the entry. */
	.entry.drop-before {
		border-top: 2px solid var(--color-brand);
	}

	.entry.drop-after {
		border-bottom: 2px solid var(--color-brand);
	}

	/* A ticket of the pool over a sorted plan (TP-5): the whole plan takes it, without a place. */
	.plan.drop-target,
	.drop-zone.drop-target {
		outline: 2px dashed var(--color-brand);
		outline-offset: 2px;
		border-radius: var(--radius-control);
	}

	.handle {
		display: inline-flex;
		flex: none;
		color: var(--color-text-muted);
		cursor: grab;
	}

	.handle svg {
		width: 1rem;
		height: 1rem;
		fill: currentColor;
	}

	.title-cell {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.title-link {
		min-width: 0;
		color: var(--color-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.missing {
		color: var(--color-text-muted);
	}

	.people {
		flex: none;
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.actions {
		display: inline-flex;
		flex: none;
		gap: 0.125rem;
		align-items: center;
	}

	.actions svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* On a touch screen every target is 44 px (ADR-0060 §2); the order changes with the buttons. */
	@media (pointer: coarse) {
		.entry {
			min-height: var(--control-height-touch);
		}

		.actions .button-icon,
		.actions :global(.button-icon) {
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
		}

		.handle {
			display: none;
		}
	}

	/*
	 * Phone frame (MO-2, ADR-0073 addendum MO-2): "Haken · Titel · •••". The check mark has a target
	 * of 44 px in both directions, "•••" has its 44 px from base.css, the title takes the rest of the
	 * row (at 360 px about two thirds) and wraps; the initials of a household stand below it. Narrow
	 * gaps and paddings, so the title gets the space.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .entry {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			column-gap: 0.25rem;
			min-height: var(--control-height-touch);
			padding: 0 0.25rem 0 0;
		}

		:global(:root[data-mobile-layout='on']) .check-target {
			display: inline-flex;
			grid-row: 1 / span 2;
			grid-column: 1;
			align-items: center;
			justify-content: center;
			align-self: center;
			min-width: var(--control-height-touch);
			min-height: var(--control-height-touch);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .title-cell {
			grid-row: 1;
			grid-column: 2;
			padding: 0.375rem 0;
		}

		:global(:root[data-mobile-layout='on']) .people {
			grid-row: 2;
			grid-column: 2;
			padding-bottom: 0.375rem;
		}

		:global(:root[data-mobile-layout='on']) .actions {
			grid-row: 1 / span 2;
			grid-column: 3;
			align-self: center;
		}
	}
</style>
