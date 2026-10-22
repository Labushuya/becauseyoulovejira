<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { TRASH_TABLE, withKeyDefaults } from '$lib/domain/columns';
	import {
		EMPTY_SELECTION,
		headState,
		keepShown,
		toggleAll,
		type Selection
	} from '$lib/domain/selection';
	import type { ProjectRef } from '$lib/domain/ticket';
	import {
		BLOCKED_RETENTION,
		chosenBlockedText,
		emptyText,
		retentionText,
		type TrashItem
	} from '$lib/domain/trash';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import type { TrashStore } from '$lib/stores/trash.svelte';
	import { trashItemHref } from '$lib/ticket-links';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import FilterButton from './FilterButton.svelte';
	import FilterSheet from './FilterSheet.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import SectionBar from './SectionBar.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { remPx } from './table/chip-measure';
	import { ColumnFit } from './table/column-fit.svelte';
	import TrashTable from './TrashTable.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// View "Papierkorb" (ADR-0037 §9): the section bar with the switch and "Papierkorb leeren …",
	// the retention with a link to the setting, and the tickets of the trash as a table. Rows are
	// chosen like in "Aufgaben" (ADR-0036 §2); the bar of the chosen rows (SelectionBar, the same
	// glass bar as there) offers "Wiederherstellen" and "Endgültig löschen …". Deleting for good
	// always asks first, says that it cannot be undone, and is no red button (ADR-0009, CLAUDE.md
	// §8). A restore that needs a choice asks inline in its row. The result of an action (notes of
	// restores, failures) stands above the table until the next one. Blocked tickets (ADR-0047)
	// can be filtered with "Nur blockierte"; deleting for good and emptying say beforehand that
	// they stay until their dependencies are decided in the preview. "Wiederherstellen" of a row
	// keeps the user here; with `onopen` its flag offers "Öffnen" (ADR-0054 §7). In a household
	// (E7-3, ADR-0059 §6) deleting for good needs the owner or the right "purge": without it
	// `canPurge` is false and the actions are not offered (the server refuses them with 403), and
	// the retention belongs to the household (`retentionHref` to its page, null without the right).
	// Phone frame (MO-7b, ADR-0073 addendum MO-7b): cards instead of the table (TrashTable); the row of
	// the view holds "Filter" (the sheet with "Nur blockierte", only while blocked tickets exist, as the
	// switch of the PC) and the menu of the list with "Auswählen" and "Papierkorb leeren …". The bulk
	// actions are one level deeper: "Auswählen" shows a box on every card and "Alle" above them, and the
	// bar of the selection stands at the bottom after the cards (SelectionBar, shared with "Aufgaben"
	// and "Eingang"), its actions behind "Aktionen", "Fertig" leaves it.
	let {
		store,
		projects,
		selfId,
		activeId = null,
		inboxCount = null,
		projectsNewCount = 0,
		canPurge = true,
		retentionHref = resolve('/einstellungen/tickets'),
		retentionNote = null,
		onopen
	}: {
		store: TrashStore;
		/** Active projects, targets of a restore that needs one. */
		projects: readonly ProjectRef[];
		selfId: string | null;
		/** Ticket shown in the preview. */
		activeId?: string | null;
		inboxCount?: number | null;
		projectsNewCount?: number;
		/** Whether "Endgültig löschen …" and "Papierkorb leeren …" are offered (E7-3). */
		canPurge?: boolean;
		/** Where the retention is changed; null when the user may not change it. */
		retentionHref?: ResolvedPathname | null;
		/** Who may change the retention, shown without the link. */
		retentionNote?: string | null;
		/** "Öffnen" in the flag of a restored ticket. */
		onopen?: (ticketId: string) => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let heading = $state<HTMLElement>();
	let selection = $state<Selection>(EMPTY_SELECTION);
	/** The pending question: one ticket, the chosen ones, or the whole trash. */
	let asking = $state<
		{ kind: 'one'; item: TrashItem } | { kind: 'many' } | { kind: 'empty' } | null
	>(null);
	/** Filter "Nur blockierte" (ADR-0047). */
	let onlyBlocked = $state(false);

	const blockedCount = $derived(store.blockedCount);
	const items = $derived(
		onlyBlocked ? store.items.filter((item) => item.dependencies > 0) : store.items
	);
	// Columns of the table (ADR-0030), shared with the menu "Spalten"; the key takes the longest
	// key of the shown tickets as its default (KN-1, Nachtrag 7).
	const rem = remPx();
	const columnFit = new ColumnFit(getColumnPrefs('trash'), () =>
		withKeyDefaults(TRASH_TABLE.columns, [{ id: 'key', keys: items.map((item) => item.key) }], rem)
	);
	const order = $derived(items.map((item) => item.id));
	const chosen = $derived(selection.ids.filter((id) => order.includes(id)));
	const chosenBlocked = $derived(
		items.filter((item) => chosen.includes(item.id) && item.dependencies > 0).length
	);
	const countLabel = $derived(
		store.items.length === 1 ? '1 Ticket' : `${store.items.length} Tickets`
	);

	// Rows that left the trash (restored, deleted, by another tab) leave the selection too.
	$effect(() => {
		const next = keepShown(selection, order);
		if (next !== selection) selection = next;
	});

	function tickets(count: number): string {
		return count === 1 ? '1 Ticket' : `${count} Tickets`;
	}

	/** "Endgültig löschen" or "Papierkorb leeren" of the confirmation. */
	async function purgeAsked() {
		const question = asking;
		asking = null;
		if (question === null) return;
		if (question.kind === 'one') await store.purge(question.item.id);
		else if (question.kind === 'many') await store.runMany('purge', chosen);
		else await store.purgeAll();
		heading?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || selection.ids.length === 0) return;
		event.preventDefault();
		selection = EMPTY_SELECTION;
	}

	/** The phone frame (MO-7b): cards, the row of the view, "Auswählen" and the bar at the bottom. */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);
	let selectMode = $state(false);
	/** "Auswählen" lasts while there are cards to choose (an emptied trash ends it). */
	const selecting = $derived(phone && items.length > 0 && (selectMode || chosen.length > 0));
	const head = $derived(headState(selection, order));
	let headBox = $state<HTMLInputElement>();

	$effect(() => {
		if (headBox) headBox.indeterminate = head === 'some';
	});

	function leaveSelectMode() {
		selectMode = false;
		selection = EMPTY_SELECTION;
	}

	/** The switch "Nur blockierte" is offered while blocked tickets exist or it is on (ADR-0047). */
	const blockedOffered = $derived(store.state === 'ready' && (blockedCount > 0 || onlyBlocked));
	let filtersOpen = $state(false);

	/** The menu "•••" of the list in the phone frame: what the bar of the PC shows besides. */
	const listActions = $derived.by((): MenuAction[] => {
		if (store.state !== 'ready' || store.items.length === 0) return [];
		const entries: MenuAction[] = [
			{ label: 'Auswählen', locked: selecting, onselect: () => (selectMode = true) }
		];
		if (canPurge) {
			entries.push({
				label: 'Papierkorb leeren …',
				dialog: true,
				busy: store.progress !== null,
				onselect: () => (asking = { kind: 'empty' })
			});
		}
		return entries;
	});
</script>

<!-- "Nur blockierte" (ADR-0047): in the bar of the PC, in the filter sheet of the phone frame. -->
{#snippet blockedSwitch()}
	<label class="switch">
		<input type="checkbox" role="switch" bind:checked={onlyBlocked} />
		Nur blockierte ({blockedCount})
	</label>
{/snippet}

<!-- The row of the view in the phone frame (MO-7b): "Filter" and the menu of the list. -->
{#snippet phoneTools()}
	{#if blockedOffered}
		<FilterButton count={onlyBlocked ? 1 : 0} onclick={() => (filtersOpen = true)} />
	{/if}
	{#if listActions.length > 0}
		<ActionsMenu
			label="Aktionen der Liste"
			buttonLabel="Weitere Aktionen der Liste"
			items={listActions}
		/>
	{/if}
{/snippet}

{#snippet sheetFilters()}
	{@render blockedSwitch()}
{/snippet}

{#snippet bulkActions()}
	<button
		class="button-secondary"
		type="button"
		onclick={() => void store.runMany('restore', chosen)}
	>
		Wiederherstellen
	</button>
	{#if canPurge}
		<button
			class="button-secondary"
			type="button"
			aria-haspopup="dialog"
			onclick={() => (asking = { kind: 'many' })}
		>
			Endgültig löschen …
		</button>
	{/if}
{/snippet}

{#snippet selectionBar(onclear: () => void)}
	<SelectionBar
		countText={chosen.length === 1 ? '1 Ticket ausgewählt' : `${chosen.length} Tickets ausgewählt`}
		progress={store.progress
			? {
					total: store.progress.total,
					done: store.progress.done,
					text: `${store.progress.label}: ${store.progress.done} von ${tickets(store.progress.total)}`
				}
			: null}
		actionsShown={chosen.length > 0}
		hint="Erst Tickets auswählen."
		{onclear}
		actions={bulkActions}
		result={store.result && store.progress === null ? resultList : undefined}
	/>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="trash-view" aria-labelledby={headingId} {onkeydown}>
	<SectionBar
		title="Papierkorb"
		{headingId}
		count={store.state === 'ready' ? store.items.length : null}
		{countLabel}
		phone={phoneTools}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="trash" {inboxCount} {projectsNewCount} />
		{/snippet}
		{#snippet end()}
			{#if blockedOffered}
				{@render blockedSwitch()}
			{/if}
			{#if store.state === 'ready' && store.items.length > 0}
				{#if canPurge}
					<button
						class="button-secondary"
						type="button"
						aria-haspopup="dialog"
						disabled={store.progress !== null}
						aria-busy={store.progress !== null ? 'true' : undefined}
						onclick={() => (asking = { kind: 'empty' })}
					>
						Papierkorb leeren …
					</button>
				{/if}
				<ColumnsPopover
					fit={columnFit}
					always="Auswahl, Key, Titel und Aktionen sind immer sichtbar."
				/>
			{/if}
		{/snippet}
	</SectionBar>

	{#if store.state === 'unavailable'}
		<SectionMessage tone="info" live>{restartNeeded('Der Papierkorb ist')}</SectionMessage>
	{:else if store.state === 'error' && store.error}
		<SectionMessage tone="error" live problem={store.errorProblem}>
			{store.error}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.reload()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state !== 'ready'}
		<p class="loading" role="status">Papierkorb wird geladen …</p>
	{:else}
		<p class="retention">
			{retentionText(store.retention)}
			{#if blockedCount > 0}{BLOCKED_RETENTION}{/if}
			{#if retentionHref !== null}
				<a href={retentionHref}>Aufbewahrung ändern</a>
			{:else if retentionNote !== null}
				{retentionNote}
			{/if}
		</p>
		{#if store.items.length === 0}
			<EmptyState
				title="Der Papierkorb ist leer"
				description="Gelöschte Tickets landen hier und lassen sich wiederherstellen."
				icon="trash"
			>
				{#snippet primary()}
					<a class="button-primary" href={resolve('/')}>Zu den Aufgaben</a>
				{/snippet}
			</EmptyState>
		{:else if items.length === 0}
			<EmptyState
				title="Keine blockierten Tickets"
				description="Über alle Abhängigkeiten ist entschieden."
				size="compact"
			>
				{#snippet secondary()}
					<button class="button-subtle" type="button" onclick={() => (onlyBlocked = false)}>
						Alle zeigen
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			{#if !phone && (chosen.length > 0 || store.progress !== null || store.result !== null)}
				{@render selectionBar(() => (selection = EMPTY_SELECTION))}
			{/if}
			{#if selecting}
				<!-- "Auswählen" in the phone frame (MO-7b): every shown ticket at once. -->
				<div class="select-mode" role="group" aria-label="Auswahl">
					<label class="select-all">
						<input
							type="checkbox"
							aria-label="Alle Tickets im Papierkorb auswählen"
							checked={head === 'all'}
							bind:this={headBox}
							onchange={() => (selection = toggleAll(selection, order))}
						/>
						Alle
					</label>
				</div>
			{/if}
			<TrashTable
				{items}
				{selection}
				onselection={(next) => (selection = next)}
				{selfId}
				{projects}
				{activeId}
				{columnFit}
				{selecting}
				hrefOf={trashItemHref}
				needOf={(id) => store.needOf(id)}
				isBusy={(id) => store.isBusy(id)}
				onrestore={(id, options) => void store.restore(id, options, onopen)}
				onpurge={canPurge ? (item) => (asking = { kind: 'one', item }) : null}
				ondismissneed={(id) => store.dismissNeed(id)}
			/>
			{#if phone && (selecting || store.progress !== null || store.result !== null)}
				<!-- The bar of "Auswählen" at the bottom, after the cards (MO-7b). -->
				{@render selectionBar(leaveSelectMode)}
			{/if}
		{/if}
	{/if}
</section>

<!-- The filter sheet of the phone frame (MO-7b); the modal gives the focus back to "Filter". -->
{#if phone && filtersOpen}
	<FilterSheet
		count={items.length}
		filtered={onlyBlocked}
		onreset={() => (onlyBlocked = false)}
		onclose={() => (filtersOpen = false)}
		filters={sheetFilters}
		ticketOrder={false}
		noun={{ one: 'Ticket', many: 'Tickets' }}
	/>
{/if}

{#snippet resultList()}
	{#if store.result}
		{@const result = store.result}
		{#if result.failures.length > 0}
			<div class="alert-error failures" role="alert">
				<ErrorIcon />
				<div>
					<p class="result-title">
						{result.failures.length === 1
							? '1 Ticket wurde nicht bearbeitet:'
							: `${result.failures.length} Tickets wurden nicht bearbeitet:`}
					</p>
					<ul>
						{#each result.failures as failure (failure.id)}
							<li><span class="key">{failure.key}</span> {failure.reason}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
		{#if result.notes.length > 0}
			<SectionMessage tone="info" compact>
				Beim Wiederherstellen:
				<ul class="notes">
					{#each result.notes as note, index (index)}
						<li>{note}</li>
					{/each}
				</ul>
			</SectionMessage>
		{/if}
		<button class="text-button" type="button" onclick={() => store.dismissResult()}>
			Ergebnis schließen
		</button>
	{/if}
{/snippet}

<ConfirmDialog
	open={asking !== null}
	title={asking?.kind === 'one'
		? `${asking.item.key} endgültig löschen?`
		: asking?.kind === 'many'
			? `${tickets(chosen.length)} endgültig löschen?`
			: 'Papierkorb leeren?'}
	confirmLabel={asking?.kind === 'empty' ? 'Papierkorb leeren' : 'Endgültig löschen'}
	onconfirm={() => void purgeAsked()}
	oncancel={() => (asking = null)}
>
	<p>
		{#if asking?.kind === 'empty'}
			{emptyText(store.items.length, blockedCount)}
		{:else if asking?.kind === 'many' && chosenBlocked > 0}
			Die Tickets werden mit ihren Unteraufgaben, Kommentaren und dem Verlauf gelöscht. {chosenBlockedText(
				chosenBlocked
			)}
		{:else}
			Das Ticket wird mit seinen Unteraufgaben, Kommentaren und dem Verlauf gelöscht.
		{/if}
		Das lässt sich nicht rückgängig machen.
	</p>
</ConfirmDialog>

<style>
	.trash-view {
		min-width: 0;
	}

	.retention {
		margin-bottom: 0.75rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.failures ul,
	.notes {
		display: grid;
		gap: 0.125rem;
		margin-top: 0.25rem;
	}

	.result-title {
		font-weight: 600;
	}

	.key {
		font-family: var(--font-mono);
	}

	.loading {
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

	/* Phone frame (MO-7b, ADR-0073 addendum MO-7b): "Alle" of "Auswählen" above the cards. */
	@media (max-width: 39.99rem) {
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
	}
</style>
