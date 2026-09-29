<script lang="ts">
	import { resolve } from '$app/paths';
	import { EMPTY_SELECTION, keepShown, type Selection } from '$lib/domain/selection';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { retentionText, type TrashItem } from '$lib/domain/trash';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import type { TrashStore } from '$lib/stores/trash.svelte';
	import { trashItemHref } from '$lib/ticket-links';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import SectionBar from './SectionBar.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import TrashTable from './TrashTable.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// View "Papierkorb" (ADR-0037 §9): the section bar with the switch and "Papierkorb leeren …",
	// the retention with a link to the setting, and the tickets of the trash as a table. Rows are
	// chosen like in "Aufgaben" (ADR-0036 §2); the bar of the chosen rows (SelectionBar, the same
	// glass bar as there) offers "Wiederherstellen" and "Endgültig löschen …". Deleting for good
	// always asks first, says that it cannot be undone, and is no red button (ADR-0009, CLAUDE.md
	// §8). A restore that needs a choice asks inline in its row. The result of an action (notes of
	// restores, failures) stands above the table until the next one.
	let {
		store,
		projects,
		selfId,
		activeId = null,
		inboxCount = null,
		projectsNewCount = 0
	}: {
		store: TrashStore;
		/** Active projects, targets of a restore that needs one. */
		projects: readonly ProjectRef[];
		selfId: string | null;
		/** Ticket shown in the preview. */
		activeId?: string | null;
		inboxCount?: number | null;
		projectsNewCount?: number;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const columnFit = new ColumnFit(getColumnPrefs('trash'));

	let heading = $state<HTMLElement>();
	let selection = $state<Selection>(EMPTY_SELECTION);
	/** The pending question: one ticket, the chosen ones, or the whole trash. */
	let asking = $state<
		{ kind: 'one'; item: TrashItem } | { kind: 'many' } | { kind: 'empty' } | null
	>(null);

	const items = $derived(store.items);
	const order = $derived(items.map((item) => item.id));
	const chosen = $derived(selection.ids.filter((id) => order.includes(id)));
	const countLabel = $derived(items.length === 1 ? '1 Ticket' : `${items.length} Tickets`);

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
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="trash-view" aria-labelledby={headingId} {onkeydown}>
	<SectionBar
		title="Papierkorb"
		{headingId}
		count={store.state === 'ready' ? items.length : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="trash" {inboxCount} {projectsNewCount} />
		{/snippet}
		{#snippet end()}
			{#if store.state === 'ready' && items.length > 0}
				<button
					class="button-secondary"
					type="button"
					aria-haspopup="dialog"
					disabled={store.progress !== null}
					onclick={() => (asking = { kind: 'empty' })}
				>
					Papierkorb leeren …
				</button>
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
		<SectionMessage tone="error" live>
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
			<a href={resolve('/einstellungen/tickets')}>Aufbewahrung ändern</a>
		</p>
		{#if items.length === 0}
			<EmptyState
				title="Der Papierkorb ist leer"
				description="Gelöschte Tickets landen hier und lassen sich wiederherstellen."
				icon="trash"
			>
				{#snippet primary()}
					<a class="button-primary" href={resolve('/')}>Zu den Aufgaben</a>
				{/snippet}
			</EmptyState>
		{:else}
			{#if chosen.length > 0 || store.progress !== null || store.result !== null}
				<SelectionBar
					countText={chosen.length === 1
						? '1 Ticket ausgewählt'
						: `${chosen.length} Tickets ausgewählt`}
					progress={store.progress
						? {
								total: store.progress.total,
								done: store.progress.done,
								text: `${store.progress.label}: ${store.progress.done} von ${tickets(store.progress.total)}`
							}
						: null}
					actionsShown={chosen.length > 0}
					onclear={() => (selection = EMPTY_SELECTION)}
					result={store.result && store.progress === null ? resultList : undefined}
				>
					{#snippet actions()}
						<button
							class="button-secondary"
							type="button"
							onclick={() => void store.runMany('restore', chosen)}
						>
							Wiederherstellen
						</button>
						<button
							class="button-secondary"
							type="button"
							aria-haspopup="dialog"
							onclick={() => (asking = { kind: 'many' })}
						>
							Endgültig löschen …
						</button>
					{/snippet}
				</SelectionBar>
			{/if}
			<TrashTable
				{items}
				{selection}
				onselection={(next) => (selection = next)}
				{selfId}
				{projects}
				{activeId}
				{columnFit}
				hrefOf={trashItemHref}
				needOf={(id) => store.needOf(id)}
				isBusy={(id) => store.isBusy(id)}
				onrestore={(id, options) => void store.restore(id, options)}
				onpurge={(item) => (asking = { kind: 'one', item })}
				ondismissneed={(id) => store.dismissNeed(id)}
			/>
		{/if}
	{/if}
</section>

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
			Alle {tickets(items.length)} im Papierkorb werden mit ihren Unteraufgaben, Kommentaren und dem Verlauf
			gelöscht.
		{:else}
			Das Ticket wird mit seinen Unteraufgaben, Kommentaren und dem Verlauf gelöscht.
		{/if}
		Das lässt sich nicht rückgängig machen. Quellen, die mit dem Ticket verworfen wurden, bleiben leer
		im Eingang unter „Verworfen“.
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
</style>
