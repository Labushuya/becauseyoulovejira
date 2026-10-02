<script lang="ts">
	import { tick } from 'svelte';
	import { ticketCount, type BulkAction } from '$lib/domain/bulk';
	import { COLOR_LABELS, PROJECT_COLORS } from '$lib/domain/colors';
	import { PRIORITY_LABELS, STATUS_LABELS } from '$lib/domain/labels';
	import type { SourceHandling } from '$lib/domain/sources';
	import { PRIORITIES, STATUSES } from '$lib/domain/status';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { progressText, type BulkEditStore } from '$lib/stores/bulk-edit.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import BulkDueDialog from './BulkDueDialog.svelte';
	import BulkTagsDialog from './BulkTagsDialog.svelte';
	import ColorMark from './ColorMark.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Modal from './overlay/Modal.svelte';
	import Popover from './overlay/Popover.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import SourceHandlingChoice from './SourceHandlingChoice.svelte';
	import { retentionText } from '$lib/domain/trash';
	import { findTrashStore } from '$lib/stores/trash.svelte';

	// Bar of the bulk actions (plan BI-2, ADR-0036 §3): it appears with at least one chosen row,
	// names their number and offers "Fälligkeit …", "Priorität", "Status", "Projekt …", since
	// ADR-0052 "Farbe" (after the migration), "Tags …", "Erledigen", "In den Papierkorb …" (before
	// AM-3 "Löschen …", now named like the menu "•••" and the question, plan aktionsmenues) and
	// "Auswahl aufheben". The glass bar itself is SelectionBar, shared with the trash (ADR-0037).
	// Priority, status and color are menus that apply at once ("Wie Projekt" removes an own color);
	// the rest asks in a modal. "Erledigen" asks only when chosen tickets have open
	// blocking sub-tasks (ADR-0033 section 2), "In den Papierkorb …" always, with the choice for the
	// sources (ADR-0031, addendum B) and the note on the trash (ADR-0037). While an action runs, a
	// progress bar replaces the buttons; the result lists every ticket that failed (as an error)
	// or was skipped (neutral).
	let {
		tickets,
		store,
		catalog,
		openBlockingOf,
		onclear
	}: {
		/** The chosen tickets, in the order of the table. */
		tickets: readonly TicketSummary[];
		store: BulkEditStore;
		catalog: CatalogStore;
		/** Open blocking sub-tasks of a ticket (ADR-0033). */
		openBlockingOf: (id: string) => readonly TicketSummary[];
		/** "Auswahl aufheben". */
		onclear: () => void;
	} = $props();

	type Dialog = 'due' | 'project' | 'tags' | 'complete' | 'delete';

	const uid = $props.id();
	const ids = {
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		withChildren: `${uid}-with-children`
	};

	const trash = findTrashStore();

	let dialog = $state<Dialog | null>(null);
	let project = $state('');
	let withChildren = $state(true);
	let sources = $state<SourceHandling>('inbox');
	/** Sources of the chosen tickets for "In den Papierkorb …"; null while unknown. */
	let sourceCount = $state<number | null>(null);
	let bar = $state<HTMLElement>();

	const count = $derived(tickets.length);
	const chosenIds = $derived(tickets.map((ticket) => ticket.id));
	const busy = $derived(store.busy);
	/** Chosen open tickets whose open blocking sub-tasks are not chosen themselves. */
	const blocked = $derived(
		tickets.filter(
			(ticket) =>
				ticket.status !== 'done' &&
				openBlockingOf(ticket.id).some((child) => !chosenIds.includes(child.id))
		)
	);
	/** Tags the chosen tickets carry, for "Tags entfernen". */
	const present = $derived(
		tickets
			.flatMap((ticket) => catalog.tagsOf(ticket))
			.filter((tag, index, all) => all.findIndex((entry) => entry.id === tag.id) === index)
			.sort((a, b) => a.name.localeCompare(b.name, 'de'))
	);

	/** Runs an action on the chosen tickets and closes its dialog. */
	async function run(action: BulkAction) {
		dialog = null;
		await store.run(action, chosenIds);
		await tick();
		// The focus stays in the bar (the rows may have left the list).
		if (bar && !bar.contains(document.activeElement)) {
			bar.querySelector<HTMLElement>('button:not([disabled]), [tabindex]')?.focus();
		}
	}

	function complete() {
		if (blocked.length > 0) {
			withChildren = true;
			dialog = 'complete';
			return;
		}
		void run({ kind: 'complete', withChildren: true });
	}

	function chooseStatus(value: (typeof STATUSES)[number]) {
		if (value === 'done') complete();
		else void run({ kind: 'status', value });
	}

	async function askDelete() {
		sources = 'inbox';
		sourceCount = null;
		dialog = 'delete';
		sourceCount = await store.sourceCount(chosenIds);
	}
</script>

<SelectionBar
	countText={count === 1 ? '1 Ticket ausgewählt' : `${count} Tickets ausgewählt`}
	progress={store.progress
		? { total: store.progress.total, done: store.progress.done, text: progressText(store.progress) }
		: null}
	actionsShown={count > 0}
	{onclear}
	bind:bar
	result={store.result && !busy ? resultList : undefined}
>
	{#snippet actions()}
		<button class="button-secondary" type="button" onclick={() => (dialog = 'due')}>
			Fälligkeit …
		</button>
		<Popover kind="menu" label="Priorität setzen" buttonClass="button-secondary">
			{#snippet button()}Priorität{/snippet}
			{#snippet children({ close })}
				{#each PRIORITIES as value (value)}
					<button
						class="item"
						type="button"
						role="menuitem"
						tabindex="-1"
						onclick={() => {
							close();
							void run({ kind: 'priority', value });
						}}
					>
						{PRIORITY_LABELS[value]}
					</button>
				{/each}
			{/snippet}
		</Popover>
		<Popover kind="menu" label="Status setzen" buttonClass="button-secondary">
			{#snippet button()}Status{/snippet}
			{#snippet children({ close })}
				{#each STATUSES as value (value)}
					<button
						class="item"
						type="button"
						role="menuitem"
						tabindex="-1"
						onclick={() => {
							close();
							chooseStatus(value);
						}}
					>
						{STATUS_LABELS[value]}
					</button>
				{/each}
			{/snippet}
		</Popover>
		<button
			class="button-secondary"
			type="button"
			onclick={() => {
				project = '';
				dialog = 'project';
			}}
		>
			Projekt …
		</button>
		{#if catalog.colorsReady}
			<Popover kind="menu" label="Farbe setzen" buttonClass="button-secondary">
				{#snippet button()}Farbe{/snippet}
				{#snippet children({ close })}
					{#each [null, ...PROJECT_COLORS] as value (value ?? '')}
						<button
							class="item"
							type="button"
							role="menuitem"
							tabindex="-1"
							onclick={() => {
								close();
								void run({ kind: 'color', value });
							}}
						>
							{#if value === null}
								Wie Projekt
							{:else}
								<span class="choice-color"
									><ColorMark
										shown={{ color: value, origin: 'own', from: null }}
										named={false}
									/></span
								>{COLOR_LABELS[value]}
							{/if}
						</button>
					{/each}
				{/snippet}
			</Popover>
		{/if}
		<button class="button-secondary" type="button" onclick={() => (dialog = 'tags')}>
			Tags …
		</button>
		<button class="button-secondary" type="button" onclick={complete}>Erledigen</button>
		<button class="button-secondary" type="button" onclick={() => void askDelete()}>
			In den Papierkorb …
		</button>
	{/snippet}
</SelectionBar>

{#snippet resultList()}
	{#if store.result}
		{@const result = store.result}
		{#if result.failures.length > 0}
			<div class="alert-error failures" role="alert">
				<ErrorIcon />
				<div>
					<p class="result-title">
						{result.failures.length === 1
							? '1 Ticket wurde nicht geändert:'
							: `${result.failures.length} Tickets wurden nicht geändert:`}
					</p>
					<ul>
						{#each result.failures as failure (failure.id)}
							<li><span class="key">{failure.key}</span> {failure.reason}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
		{#if result.skipped.length > 0}
			<SectionMessage tone="info" compact>
				{result.skipped.length === 1
					? '1 Ticket übersprungen:'
					: `${result.skipped.length} Tickets übersprungen:`}
				<ul class="skipped">
					{#each result.skipped as skip (skip.id)}
						<li><span class="key">{skip.key}</span> {skip.reason}</li>
					{/each}
				</ul>
			</SectionMessage>
		{/if}
		<button class="text-button" type="button" onclick={() => store.dismissResult()}>
			Ergebnis schließen
		</button>
	{/if}
{/snippet}

{#if dialog === 'due'}
	<BulkDueDialog {count} onapply={(action) => void run(action)} onclose={() => (dialog = null)} />
{:else if dialog === 'tags'}
	<BulkTagsDialog
		{count}
		tags={catalog.tags}
		{present}
		oncreatetag={(name) => catalog.ensureTag(name)}
		onapply={(action) => void run(action)}
		onclose={() => (dialog = null)}
	/>
{:else if dialog === 'project'}
	<Modal open size="s" title={`Projekt für ${ticketCount(count)}`} onclose={() => (dialog = null)}>
		<div class="field">
			<label for={ids.project}>Projekt</label>
			<ProjectSelect
				id={ids.project}
				value={project}
				projects={catalog.activeProjects}
				error={null}
				errorId={`${ids.project}-error`}
				hintId={ids.projectHint}
				hint="Ein anderes Projekt gibt jedem Ticket einen neuen Key; der alte steht im Verlauf."
				onchoose={(value) => (project = value)}
			/>
		</div>
		{#snippet footer({ close })}
			<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
			<button
				class="button-primary"
				type="button"
				onclick={() => void run({ kind: 'project', projectId: project === '' ? null : project })}
			>
				Übernehmen
			</button>
		{/snippet}
	</Modal>
{/if}

<ConfirmDialog
	open={dialog === 'complete'}
	title={`${ticketCount(count)} erledigen?`}
	confirmLabel="Erledigen"
	onconfirm={() => void run({ kind: 'complete', withChildren })}
	oncancel={() => (dialog = null)}
>
	<p>
		{blocked.length === 1
			? `${blocked[0]?.key ?? ''} hat noch offene Unteraufgaben.`
			: `${blocked.length} Tickets haben noch offene Unteraufgaben.`}
		Ohne sie bleiben diese Tickets offen und stehen mit Grund im Ergebnis.
	</p>
	{#snippet options()}
		<label class="option">
			<input id={ids.withChildren} type="checkbox" bind:checked={withChildren} />
			Unteraufgaben mit erledigen
		</label>
	{/snippet}
</ConfirmDialog>

<ConfirmDialog
	open={dialog === 'delete'}
	title={`${ticketCount(count)} in den Papierkorb verschieben?`}
	confirmLabel="In den Papierkorb"
	onconfirm={() => void run({ kind: 'delete', sources })}
	oncancel={() => (dialog = null)}
>
	<p>
		Die Tickets kommen mit Kommentaren, Verlauf und Unteraufgaben in den Papierkorb und lassen sich
		dort wiederherstellen.
		{#if trash}{retentionText(trash.retention)}{/if}
	</p>
	{#if sourceCount !== null && sourceCount > 0}
		<p>
			{sourceCount === 1
				? 'Zu diesen Tickets gehört 1 Quelle.'
				: `Zu diesen Tickets gehören ${sourceCount} Quellen.`}
		</p>
	{/if}
	{#snippet options()}
		{#if sourceCount !== null && sourceCount > 0}
			<SourceHandlingChoice bind:handling={sources} />
		{/if}
	{/snippet}
</ConfirmDialog>

<style>
	.failures ul,
	.skipped {
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

	.field {
		display: grid;
		gap: 0.375rem;
	}

	.field label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.option {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	/* The dot before the name of a color in the menu "Farbe" (ADR-0052). */
	.choice-color {
		margin-right: 0.5rem;
	}
</style>
