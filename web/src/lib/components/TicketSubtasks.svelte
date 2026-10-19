<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { isCalendarDate, type CalendarDate } from '$lib/domain/berlin-date';
	import {
		TEMPLATE_STATUSES,
		isTemplateStatus,
		subtaskStatusOf,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import { assigneeName } from '$lib/domain/assignee';
	import { joinWords } from '$lib/domain/recurrence-text';
	import { progressLabel, progressPercent, progressText } from '$lib/domain/subtasks';
	import type { TemplateOffer } from '$lib/domain/series-template';
	import { TRANSFER_TEXTS, type TransferNames } from '$lib/domain/subtask-transfer';
	import {
		tagChangeOf,
		type ParentChange,
		type TagChangeNames
	} from '$lib/domain/subtask-transfer-change';
	import { TITLE_MAX_LENGTH, type TicketSummary } from '$lib/domain/ticket';
	import { flagOutlets } from '$lib/overlay/flag-outlets.svelte';
	import { insideModal } from '$lib/overlay/modal-context';
	import { findAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { findFlagStore, type FlagStore } from '$lib/stores/flags.svelte';
	import { OngoingFinishAsk } from '$lib/stores/ongoing-finish.svelte';
	import {
		findTransferOfferStore,
		type TransferOfferStore
	} from '$lib/stores/subtask-transfer-offer.svelte';
	import {
		findSubtaskTransferStore,
		type SubtaskTransferStore
	} from '$lib/stores/subtask-transfer.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import DoneToggle from './DoneToggle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import OngoingFinishDialog from './OngoingFinishDialog.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import SubtaskTransferDialog from './SubtaskTransferDialog.svelte';
	import StatusMenu from './table/StatusMenu.svelte';

	// Section "Unteraufgaben" (ADR-0033 section 4), shared by the side panel and the full view: the
	// sub-tasks of a top-level ticket with check mark, key, title (link to their panel) and status,
	// open ones first, then by creation; the progress as text and as a quiet bar. Since UT-1 (ADR-0033
	// addendum UT-1) the status of each is the menu of the table "Aufgaben" (StatusMenu): a choice
	// saves at once like a cell, "Erledigt" goes through the check mark with "Rückgängig"; the check
	// mark stays. "Unteraufgabe hinzufügen" opens a small form in the section: the title, the status
	// (every one but "Erledigt", the one of the ticket in advance, "Offen" under a done one) and the
	// due date (the one of the ticket in advance, to change or clear). Enter or "Anlegen" creates one
	// (project, tags, kind and assignee of the ticket) and keeps the form for the next with its choices;
	// Escape or "Schließen" closes it, Escape is consumed, so neither the panel nor the full view
	// closes. Everything comes from the list store and follows realtime. A sub-task that is an ongoing
	// project (it takes the kind of its ticket) asks "Vorhaben abschließen?" before its check mark or
	// "Erledigt" of its status menu completes it (VH-1); in the full view the question stands inline
	// in this section. Since UE-1 (ADR-0070) "Auf Unteraufgaben übertragen …" stands next to "Unteraufgabe
	// hinzufügen" once the ticket has a sub-task: the dialog gives chosen fields of the ticket to its
	// sub-tasks (SubtaskTransferDialog, a modal M; in the full view inline in this section). Whoever sees
	// the section may change the ticket (the update rule of tickets is their view rule); the server checks
	// it again for every sub-task. Since UE-2 (ADR-0070 addendum UE-2) "Übertragen …" of the flag after
	// a change of the ticket opens the same dialog here in its mode "nach Änderung"; the focus goes to
	// "Auf Unteraufgaben übertragen …" first, so it comes back there. In the side panel the dialog
	// waits while another dialog is open (the flag stood in front of it): no dialog over a dialog.
	let {
		ticket,
		list,
		hrefOf,
		catalog = null,
		transfer = findSubtaskTransferStore(),
		offers = findTransferOfferStore(),
		flags = findFlagStore(),
		assignees = findAssignees()
	}: {
		ticket: TicketSummary;
		list: Pick<
			TicketListStore,
			| 'subtasksOf'
			| 'progressOf'
			| 'isChecked'
			| 'isPending'
			| 'setDone'
			| 'changeField'
			| 'addSubtask'
		>;
		/** Address of the panel of a sub-task, with the list query of the current page. */
		hrefOf: (id: string) => ResolvedPathname;
		/** Names of project and tags of the ticket; without it those the ticket carries. */
		catalog?: Pick<CatalogStore, 'projectOf' | 'tagsOf'> | null;
		/** "Auf Unteraufgaben übertragen …" (UE-1); none outside the (app) layout. */
		transfer?: SubtaskTransferStore | null;
		/** The flag "Übertragen …" after a change (UE-2); none outside the (app) layout. */
		offers?: TransferOfferStore | null;
		/** The flags of the layout: where they stand tells whether a dialog is open in front. */
		flags?: FlagStore | null;
		/** Members of the household for the name of the assignee; none outside the layout. */
		assignees?: AssigneeSource | null;
	} = $props();

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		progress: `${uid}-progress`,
		input: `${uid}-input`,
		status: `${uid}-status`,
		due: `${uid}-due`,
		dueError: `${uid}-due-error`,
		hint: `${uid}-hint`,
		error: `${uid}-error`
	};

	const subtasks = $derived(list.subtasksOf(ticket.id));
	const progress = $derived(list.progressOf(ticket.id));
	/** What a new sub-task takes from the ticket without asking, for the hint of the form. */
	const inherited = $derived(
		joinWords([
			'Projekt',
			'Tags',
			...(ticket.kind === 'ongoing' ? ['Art'] : []),
			...(ticket.assignee ? ['Zuständigkeit'] : [])
		])
	);

	let adding = $state(false);
	let text = $state('');
	/** Status and due date of the next sub-task; set from the ticket when the form opens. */
	let status = $state<TemplateStatus>('open');
	let due = $state('');
	let dueInvalid = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	/** Polite message after creating one, e.g. "TASK-16 angelegt." */
	let announcement = $state('');
	let input = $state<HTMLInputElement>();
	let dueInput = $state<HTMLInputElement>();
	let addButton = $state<HTMLButtonElement>();

	/** "Vorhaben abschließen?" before a sub-task that is an ongoing project is completed (VH-1). */
	const finishing = new OngoingFinishAsk();

	/** "Auf Unteraufgaben übertragen …" (UE-1): inside a modal (the full view) the dialog is inline. */
	const inline = insideModal();
	/** Ticket whose dialog is open; another ticket in the same section starts without it. */
	let transferringFor = $state<string | null>(null);
	let transferButton = $state<HTMLButtonElement>();
	const transferShown = $derived(transfer !== null && subtasks.length > 0);
	const transferring = $derived(transferShown && transferringFor === ticket.id);
	/** The mode "nach Änderung" of the open dialog (UE-2), null for the mode of UE-1. */
	let afterChange = $state.raw<{
		change: ParentChange;
		series: TemplateOffer | null;
		tagNames: TagChangeNames;
	} | null>(null);
	/** "Übertragen …" of the flag of this ticket waits for this section (UE-2). */
	const requested = $derived(offers?.requestFor(ticket.id) ?? null);
	/** A dialog is open in front of the side panel; the flag stood in it. */
	const otherDialog = $derived(flags !== null && flagOutlets.hostOf(flags) !== null);

	/** Names of the tags the change added and removed, as the catalog knows them. */
	function tagNamesOf(change: ParentChange): TagChangeNames {
		const tags = tagChangeOf(change, ticket);
		const named = (ids: readonly string[], fallback: TicketSummary) =>
			(catalog?.tagsOf({ tagIds: [...ids], tags: fallback.tags }) ?? fallback.tags)
				.filter((tag) => ids.includes(tag.id))
				.map((tag) => tag.name);
		return {
			added: named(tags?.add ?? [], ticket),
			removed: named(tags?.remove ?? [], change.before)
		};
	}

	$effect(() => {
		if (requested === null || offers === null || !transferShown) return;
		if (!inline && !transferring && otherDialog) return;
		untrack(() => {
			const change = offers.take(ticket.id);
			if (change === null) return;
			// The opener of the dialog is the button of this section, not the flag that is gone.
			transferButton?.focus();
			afterChange = { change, series: offers.seriesOffer(change), tagNames: tagNamesOf(change) };
			transferringFor = ticket.id;
		});
	});
	/** What the dialog names of the ticket; the assignee only where the field shows (ADR-0068). */
	const transferNames = $derived.by((): TransferNames => {
		const assigneeShown =
			ticket.assignee !== undefined &&
			(ticket.scope ?? '').startsWith('h:') &&
			assignees !== null &&
			assignees.members.length > 0;
		return {
			project: catalog?.projectOf(ticket) ?? ticket.project,
			tags: (catalog?.tagsOf(ticket) ?? ticket.tags).map((tag) => tag.name),
			assignee:
				assigneeShown && assignees !== null
					? ticket.assignee
						? assigneeName(ticket.assignee, assignees.context)
						: ''
					: null
		};
	});

	/** The check mark of a sub-task; an open ongoing project asks first. */
	function toggleDone(child: TicketSummary, done: boolean) {
		if (!done) return void list.setDone(child.id, false);
		void finishing.run([child], () => list.setDone(child.id, true));
	}

	/** A status of the menu; "Erledigt" of an open ongoing project asks first. */
	function chooseStatus(child: TicketSummary, value: TicketSummary['status']) {
		if (value === child.status) return;
		if (value !== 'done') return void list.changeField(child.id, { status: value });
		void finishing.run([child], () => list.changeField(child.id, { status: value }));
	}

	async function open() {
		adding = true;
		error = null;
		announcement = '';
		status = subtaskStatusOf(undefined, ticket.status);
		due = ticket.due ?? '';
		dueInvalid = false;
		await tick();
		input?.focus();
	}

	async function close() {
		adding = false;
		text = '';
		error = null;
		await tick();
		addButton?.focus();
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (text.trim() === '') {
			input?.focus();
			return;
		}
		if (dueInvalid || (due !== '' && !isCalendarDate(due))) {
			dueInvalid = true;
			dueInput?.focus();
			return;
		}
		busy = true;
		error = null;
		const title = text;
		const result = await list.addSubtask(ticket, title, {
			status,
			due: due === '' ? null : (due as CalendarDate)
		});
		busy = false;
		if (result.ok) {
			// What was typed meanwhile stays; only the saved title leaves the field.
			if (text === title) text = '';
			announcement = `${result.ticket.key} angelegt.`;
			input?.focus();
		} else if (result.message !== null) {
			error = result.message;
		}
	}

	/** Escape anywhere in the form closes it and is consumed. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		void close();
	}
</script>

<section class="subtasks" aria-labelledby={ids.title} data-ticket-option="subtasks">
	<div class="section-head">
		<h3 id={ids.title}>Unteraufgaben</h3>
		{#if progress.total > 0}
			<span class="progress-text" id={ids.progress}>
				<span aria-hidden="true">{progressText(progress)}</span>
				<span class="visually-hidden">{progressLabel(progress)}</span>
			</span>
		{/if}
	</div>
	{#if progress.total > 0}
		<div class="bar" aria-hidden="true">
			<span class="bar-fill" style:width={`${progressPercent(progress)}%`}></span>
		</div>
		<ul class="list" aria-labelledby={ids.title}>
			{#each subtasks as child (child.id)}
				<li class="item" class:done={child.status === 'done'}>
					<DoneToggle
						key={child.key}
						checked={list.isChecked(child)}
						pending={list.isPending(child.id)}
						onchange={(done) => toggleDone(child, done)}
					/>
					<span class="key">{child.key}</span>
					<a class="child-title" href={hrefOf(child.id)}>{child.title}</a>
					<span class="status-menu">
						<StatusMenu
							ticketKey={child.key}
							status={child.status}
							busy={list.isPending(child.id)}
							onchoose={(value) => chooseStatus(child, value)}
						/>
					</span>
				</li>
			{/each}
		</ul>
	{:else if !adding}
		<p class="muted">Keine Unteraufgaben.</p>
	{/if}

	<!-- Completing a sub-task that is an ongoing project asks first (VH-1); inline in the full view. -->
	{#if finishing.question}
		<OngoingFinishDialog
			question={finishing.question}
			onconfirm={() => finishing.accept()}
			oncancel={() => finishing.cancel()}
		/>
	{/if}

	{#if adding}
		<!-- Escape from any field of the form closes it (the keys stay with the fields). -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			class="add"
			novalidate
			aria-label="Unteraufgabe hinzufügen"
			aria-busy={busy ? 'true' : undefined}
			onsubmit={add}
			{onkeydown}
		>
			<label class="visually-hidden" for={ids.input}>Titel der Unteraufgabe</label>
			<input
				id={ids.input}
				type="text"
				maxlength={TITLE_MAX_LENGTH}
				placeholder="Titel der Unteraufgabe"
				autocomplete="off"
				bind:value={text}
				bind:this={input}
				aria-busy={busy ? 'true' : undefined}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
			/>
			<div class="options">
				<div class="field">
					<label for={ids.status}>Status</label>
					<StatusSelect
						id={ids.status}
						value={status}
						statuses={TEMPLATE_STATUSES}
						errorId={`${ids.status}-error`}
						onchoose={(value) => {
							if (isTemplateStatus(value)) status = value;
						}}
					/>
				</div>
				<div class="field">
					<label for={ids.due}>Fälligkeit</label>
					<input
						id={ids.due}
						type="date"
						bind:value={due}
						bind:this={dueInput}
						aria-invalid={dueInvalid ? 'true' : undefined}
						aria-describedby={dueInvalid ? ids.dueError : undefined}
						oninput={(event) => (dueInvalid = event.currentTarget.validity.badInput)}
					/>
					{#if dueInvalid}
						<p class="field-error" id={ids.dueError}>
							<ErrorIcon /><span>Ungültiges Datum.</span>
						</p>
					{/if}
				</div>
			</div>
			<p class="hint" id={ids.hint}>
				Enter legt sie an, Esc schließt. Status und Fälligkeit sind nach dem Ticket vorbelegt;
				{inherited} übernimmt sie vom Ticket.
			</p>
			{#if error}
				<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
			{/if}
			<div class="actions">
				<button
					class="button-primary button-small"
					type="submit"
					aria-disabled={busy ? 'true' : undefined}
					aria-busy={busy ? 'true' : undefined}
				>
					Anlegen
				</button>
				<button class="button-subtle button-small" type="button" onclick={() => void close()}>
					Schließen
				</button>
			</div>
		</form>
	{/if}
	{#if !adding || transferShown}
		<div class="section-actions">
			{#if !adding}
				<button
					class="button-secondary button-small"
					type="button"
					bind:this={addButton}
					onclick={open}
				>
					Unteraufgabe hinzufügen
				</button>
			{/if}
			{#if transferShown}
				<button
					class="button-secondary button-small"
					type="button"
					aria-haspopup={inline ? undefined : 'dialog'}
					aria-expanded={inline ? transferring : undefined}
					bind:this={transferButton}
					onclick={() => {
						afterChange = null;
						transferringFor = inline && transferring ? null : ticket.id;
					}}
				>
					{TRANSFER_TEXTS.action}
				</button>
			{/if}
		</div>
	{/if}
	{#if transferring && transfer !== null}
		<!-- A new request of the flag opens the dialog anew in its mode. -->
		{#key afterChange}
			<SubtaskTransferDialog
				parent={ticket}
				{subtasks}
				store={transfer}
				names={transferNames}
				{afterChange}
				applySeries={offers === null ? null : (offer) => offers.applySeries(offer)}
				returnFocus={() => transferButton}
				onclose={() => {
					transferringFor = null;
					afterChange = null;
				}}
			/>
		{/key}
	{/if}
	<p class="visually-hidden" aria-live="polite">{announcement}</p>
</section>

<style>
	.subtasks {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		justify-items: start;
	}

	.section-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		justify-content: space-between;
		justify-self: stretch;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.progress-text {
		font-size: var(--font-size-small);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* Quiet bar: the line colour as track, the accent for the done share. */
	.bar {
		justify-self: stretch;
		height: 0.25rem;
		overflow: hidden;
		background: var(--color-line);
		border-radius: var(--radius-pill);
	}

	.bar-fill {
		display: block;
		height: 100%;
		background: var(--color-brand);
		border-radius: var(--radius-pill);
	}

	.list {
		display: grid;
		justify-self: stretch;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.125rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.child-title {
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.child-title:hover {
		text-decoration: underline;
	}

	/* The menu of the status (StatusMenu) is one cell of the row; its button keeps the look of the
	   table, and only the pill shows: the pencil comes on pointing and focus. */
	.status-menu {
		display: flex;
		min-width: 0;
	}

	/* Done sub-tasks step back (CLAUDE.md section 8). */
	.done .child-title {
		color: var(--color-text-muted);
	}

	.add {
		display: grid;
		gap: 0.5rem;
		justify-self: stretch;
	}

	.add > input {
		width: 100%;
	}

	/* Status and due date side by side; on a narrow panel they wrap below each other. */
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		align-content: start;
		min-width: 0;
	}

	.field label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.actions,
	.section-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.hint,
	.muted {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	/* Touch screens: the menu of the status is as easy to hit as the other controls (44 px). */
	@media (pointer: coarse) {
		.status-menu :global(button.cell-edit) {
			min-height: var(--control-height-touch);
		}
	}
</style>
