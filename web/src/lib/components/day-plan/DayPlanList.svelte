<script lang="ts" module>
	/** Types of the data a drag carries (ADR-0065 §4): an entry of the plan or a ticket of the pool. */
	export const DRAG_ITEM = 'application/x-byl-dayplan-item';
	export const DRAG_TICKET = 'application/x-byl-ticket';

	/** Whether a drag carries an entry or a ticket this list takes. */
	export function carriesPlanData(types: readonly string[] | DOMStringList | undefined): boolean {
		if (types === undefined) return false;
		const list = [...(types as Iterable<string>)];
		return list.includes(DRAG_ITEM) || list.includes(DRAG_TICKET);
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { SOURCE_LABELS, initialsOf, type DayPlanSource } from '$lib/domain/day-plan';
	import { personLabel } from '$lib/domain/people';
	import { auth } from '$lib/auth.svelte';
	import type { DayPlanStore, PlanRow } from '$lib/stores/day-plan.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { findPeople } from '$lib/stores/people.svelte';
	import ActionsMenu, { type MenuAction } from '../ActionsMenu.svelte';
	import CharmIcon from '../CharmIcon.svelte';
	import KindBadge from '../KindBadge.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';

	// The entries of a day plan (ADR-0065 §4): a list in the order of the plan. Each entry has its check
	// mark (a task is completed, an ongoing project checked for the day; ADR-0065 §2), the charm, key
	// and title as a link that opens the ticket next to the plan, the badge "Vorhaben", in a household
	// the initials of who added and checked it (names in the tooltip and for screen readers), and the
	// menu with the other way of checking, "Auf morgen schieben", the kind and "Entfernen". The order
	// changes by dragging an entry at its handle, by "Nach oben" and "Nach unten" and by Alt+arrow
	// anywhere in the entry; a ticket of the pool can be dropped at a place. Days before are read-only:
	// no check mark to change, no handle, no menu.
	let {
		store,
		household = false,
		onfinish
	}: {
		store: DayPlanStore;
		/** The plan of a household: who added and who checked an entry shows as initials. */
		household?: boolean;
		/** "Vorhaben abschließen …": the view asks first. */
		onfinish: (row: PlanRow) => void;
	} = $props();

	const links = ticketLinks();
	const people = findPeople();

	let list = $state<HTMLOListElement>();
	/** The place a drag would drop at (before the entry with this index), null without a drag. */
	let dropIndex = $state<number | null>(null);
	/** The entry being dragged. */
	let dragging = $state<string | null>(null);

	const rows = $derived(store.rows);
	const editable = $derived(store.editable);

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

	function menuOf(row: PlanRow): MenuAction[] {
		const id = row.item.id;
		const ticket = row.ticket;
		const items: MenuAction[] = [];
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
		if (!editable || !event.altKey || event.defaultPrevented) return;
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		if (event.target instanceof Element && event.target.closest('[popover]') !== null) return;
		event.preventDefault();
		void move(row, event.key === 'ArrowUp' ? -1 : 1);
	}

	// --- Dragging (native, ADR-0065 §4) -----------------------------------------------------------

	function onDragStart(event: DragEvent, row: PlanRow) {
		if (!editable || event.dataTransfer === null) return;
		event.dataTransfer.setData(DRAG_ITEM, row.item.id);
		event.dataTransfer.effectAllowed = 'move';
		const entry = (event.currentTarget as HTMLElement).closest('li');
		if (entry !== null) event.dataTransfer.setDragImage(entry, 16, 16);
		dragging = row.item.id;
	}

	function onDragEnd() {
		dragging = null;
		dropIndex = null;
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
		if (!editable || !carriesPlanData(event.dataTransfer?.types)) return;
		event.preventDefault();
		if (event.dataTransfer !== null) {
			event.dataTransfer.dropEffect = dragging !== null ? 'move' : 'copy';
		}
		dropIndex = indexAt(event.clientY);
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
	}

	function onDrop(event: DragEvent) {
		if (!editable || event.dataTransfer === null) return;
		const itemId = event.dataTransfer.getData(DRAG_ITEM);
		const ticketId = event.dataTransfer.getData(DRAG_TICKET);
		if (itemId === '' && ticketId === '') return;
		event.preventDefault();
		const index = dropIndex ?? indexAt(event.clientY);
		dropIndex = null;
		dragging = null;
		if (itemId !== '') {
			const from = rows.findIndex((row) => row.item.id === itemId);
			if (from === -1) return;
			void store.moveTo(itemId, index > from ? index - 1 : index);
		} else {
			void store.add(ticketId, index);
		}
	}
</script>

<div
	class="plan"
	role="group"
	aria-label="Einträge des Plans"
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	{#if rows.length === 0}
		<div class="drop-zone" class:drop-target={dropIndex !== null}>
			<EmptyState
				size="compact"
				title={editable ? 'Noch nichts geplant' : 'Kein Eintrag an diesem Tag'}
				description={editable
					? 'Vorschläge übernehmen, im Pool mit „+“ aufnehmen oder ein Ticket hierher ziehen.'
					: undefined}
			/>
		</div>
	{:else}
		<ol class="entries" bind:this={list}>
			{#each rows as row, index (row.item.id)}
				{@const ticket = row.ticket}
				{@const key = keyOf(row)}
				{@const pending = store.isPending(row.item.id)}
				<!-- Alt+arrow anywhere in the entry moves it; the keys come from its own controls. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<li
					class="entry"
					class:done={row.done}
					class:dragging={dragging === row.item.id}
					class:drop-before={dropIndex === index}
					class:drop-after={dropIndex === rows.length && index === rows.length - 1}
					data-item-id={row.item.id}
					aria-busy={pending ? 'true' : undefined}
					onkeydown={(event) => onRowKeydown(event, row)}
				>
					{#if editable}
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
					<span class="title-cell">
						{#if ticket !== null}
							<CharmIcon charm={ticket.charm} />
							<span class="key">{ticket.key}</span>
							<a
								class="title-link"
								href={links.href(ticket.id, page.url)}
								data-ticket-link={ticket.id}>{ticket.title}</a
							>
							<KindBadge kind={row.kind} />
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
								aria-disabled={index === rows.length - 1 || pending ? 'true' : undefined}
								onclick={() => void move(row, 1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
									<path d="M8 3.5v9M4 9l4 4 4-4" />
								</svg>
							</button>
							<ActionsMenu
								label={`Aktionen für ${key}`}
								buttonLabel={`Weitere Aktionen für ${key}`}
								buttonTitle="Weitere Aktionen"
								items={menuOf(row)}
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

	.entries {
		display: grid;
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
</style>
