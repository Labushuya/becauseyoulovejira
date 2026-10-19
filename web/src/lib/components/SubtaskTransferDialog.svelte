<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		appliedTitle,
		templateRefusedText,
		type TemplateApplyResult,
		type TemplateOffer
	} from '$lib/domain/series-template';
	import {
		OPEN_TARGETS,
		TRANSFER_TEXTS,
		chosenInAdvance,
		fieldOffers,
		fieldsOf,
		hasFields,
		initialFields,
		isOpenSubtask,
		summaryText,
		targetsOf,
		targetsRequest,
		transferSummary,
		transferredText,
		type TargetChoice,
		type TransferField,
		type TransferNames
	} from '$lib/domain/subtask-transfer';
	import {
		CHANGE_TEXTS,
		changeFieldOffers,
		changeFieldsOf,
		changeInitialFields,
		dueShiftOf,
		pendingFields,
		seriesHint,
		shiftLabel,
		withoutDueCount,
		withoutDueText,
		type DueChoice,
		type ParentChange,
		type TagChangeNames
	} from '$lib/domain/subtask-transfer-change';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { SubtaskTransferStore } from '$lib/stores/subtask-transfer.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import PcOnly from './guidance/PcOnly.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): chosen fields of a ticket go to its sub-tasks.
	// "Felder" are checkboxes with the value of the ticket (due date and priority checked in advance, or
	// the last confirmed choice of this device, never the project); "Ziel" is "Alle offenen
	// Unteraufgaben" or "Auswählen …" with every sub-task, the done ones marked and not chosen in
	// advance. The line below counts what changes. The values are those of the ticket when the dialog
	// opened: the server reads its own and answers 409 when the ticket changed since. In the side panel
	// a modal M; inside a modal (the full view) the same form stands inline (InlineDialog, ADR-0025
	// addendum 16). Before the restart after UE-1 the dialog shows the hint to restart instead.
	//
	// Since UE-2 (ADR-0070 addendum UE-2) the flag "Übertragen …" opens it in the mode "nach Änderung"
	// (`afterChange`): exactly the changed fields are checked (the remembered choice neither counts nor
	// changes), a changed due date offers "Gleiches Datum wie das Hauptticket" or "Um denselben Abstand
	// verschieben (+3 Tage)", changed tags go as the change (added and removed), and where the offer of
	// the series would have come, "Auch für künftige Tickets übernehmen" (not checked) writes the same
	// into the template, together with the target "Keine". The two parts are two requests: when one
	// fails, the dialog says what worked and offers "Erneut versuchen" for the other; nothing closes
	// silently. Before the restart the hint stands instead of the fields, the checkbox of the series
	// stays.
	let {
		parent,
		subtasks,
		store,
		names,
		afterChange = null,
		applySeries = null,
		onclose,
		returnFocus
	}: {
		parent: TicketSummary;
		/** All sub-tasks of the ticket, open ones first (the list of the section). */
		subtasks: readonly TicketSummary[];
		store: SubtaskTransferStore;
		/** Project, tag names and assignee of the ticket as the dialog names them. */
		names: TransferNames;
		/**
		 * The mode "nach Änderung" (UE-2): the change of the flag, the offer of the series it would
		 * have brought (null: none) and the names of the changed tags; null for the mode of UE-1.
		 */
		afterChange?: {
			change: ParentChange;
			series: TemplateOffer | null;
			tagNames: TagChangeNames;
		} | null;
		/** Writes the offer of the series (the way of the flag of the series). */
		applySeries?: ((offer: TemplateOffer) => Promise<TemplateApplyResult>) | null;
		/** Cancel, or after the transfer. */
		onclose: () => void;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;
	const summaryId = `${uid}-summary`;
	const shiftHintId = `${uid}-shift-hint`;
	const seriesHintId = `${uid}-series-hint`;
	const inline = insideModal();

	/** The ticket as the dialog opened: its values are what the user confirms. */
	const shown = untrack(() => ({ ...parent }));
	const shownNames = untrack(() => ({ ...names }));
	const after = untrack(() => afterChange);
	const offers =
		after === null
			? fieldOffers(shown, shownNames)
			: changeFieldOffers(shown, shownNames, after.change, after.tagNames);
	/** The distance of a changed due date, when the dialog offers to move by it. */
	const shift =
		after !== null && pendingFields(after.change).includes('due') && shown.due !== null
			? dueShiftOf(after.change)
			: null;
	/** "Auch für künftige Tickets übernehmen" with what it writes; only where the series offered it. */
	const seriesOffer = after !== null && untrack(() => applySeries) !== null ? after.series : null;

	let chosen = $state<TransferField[]>(
		untrack(() =>
			after === null
				? [...initialFields(store.rememberedFields, offers, shown)]
				: [...changeInitialFields(offers, after.change)]
		)
	);
	let dueChoice = $state<DueChoice>('same');
	let mode = $state<'open' | 'chosen' | 'none'>('open');
	let chosenIds = $state<string[]>(
		untrack(() => {
			const advance = chosenInAdvance(subtasks);
			return advance.mode === 'chosen' ? [...advance.ids] : [];
		})
	);
	let seriesChecked = $state(false);
	let busy = $state(false);
	/** The server answered the transfer with "unknown route" (before the restart). */
	let routeMissing = $state(false);

	/** The state of one of the two requests (sub-tasks, series). */
	type Part =
		| { readonly state: 'idle' }
		| { readonly state: 'done'; readonly text: string }
		| { readonly state: 'failed'; readonly message: string; readonly retry: boolean };
	const IDLE: Part = { state: 'idle' };
	let transferPart = $state.raw<Part>(IDLE);
	let seriesPart = $state.raw<Part>(IDLE);

	const support = $derived(routeMissing ? 'missing' : store.support);
	const openCount = $derived(subtasks.filter(isOpenSubtask).length);
	const choice = $derived<TargetChoice>(
		mode === 'chosen' ? { mode: 'chosen', ids: new Set(chosenIds) } : OPEN_TARGETS
	);
	const fields = $derived(
		after === null
			? fieldsOf(new Set(chosen), shown)
			: changeFieldsOf(new Set(chosen), shown, after.change, dueChoice)
	);
	/** Once one part is done, the choice stays as it was sent; only the failed part goes again. */
	const locked = $derived(transferPart.state === 'done' || seriesPart.state === 'done');
	const wantsTransfer = $derived(support !== 'missing' && mode !== 'none');
	const wantsSeries = $derived(seriesOffer !== null && seriesChecked);
	const targets = $derived(wantsTransfer ? targetsOf(subtasks, choice) : []);
	const summary = $derived(transferSummary(shown, targets, fields));
	const transferReady = $derived(support === 'ready' && hasFields(fields) && targets.length > 0);
	const ready = $derived(
		!locked && (wantsTransfer || wantsSeries) && (!wantsTransfer || transferReady)
	);
	const summaryLine = $derived(
		wantsTransfer
			? [summaryText(summary), withoutDueText(withoutDueCount(targets, fields))]
					.filter((text) => text !== '')
					.join(' ')
			: CHANGE_TEXTS.untouched
	);
	const submitShown = $derived(!locked && (support !== 'missing' || seriesOffer !== null));
	const submitText = $derived(
		wantsTransfer || seriesOffer === null ? TRANSFER_TEXTS.submit : CHANGE_TEXTS.seriesOnly
	);

	// Every opening asks what the server knows (unless it named everything already).
	$effect(() => untrack(() => void store.loadSupport()));

	const hintId = (field: TransferField) => `${uid}-${field}-hint`;

	/** The sub-tasks: done, failed with its message, or nothing to show (no session, before restart). */
	async function sendTransfer(): Promise<void> {
		const result = await store.transfer(
			{ id: shown.id, key: shown.key },
			{
				expectedUpdated: shown.updated,
				fields,
				targets: targetsRequest(subtasks, choice)
			},
			chosen,
			after === null
		);
		if (result.ok) {
			transferPart = { state: 'done', text: transferredText(result.outcome.changed) };
		} else if (result.missing) {
			routeMissing = true;
			transferPart = IDLE;
		} else if (result.message !== null) {
			// 409: sending the same again cannot help, the dialog says to open it anew.
			transferPart = { state: 'failed', message: result.message, retry: result.stale !== true };
		} else {
			transferPart = IDLE;
		}
	}

	/** The series: the same writes as its flag; a refusal or a lost request stays as a message. */
	async function sendSeries(offer: TemplateOffer): Promise<void> {
		if (applySeries === null) return;
		const result = await applySeries(offer);
		if (result.ended) return;
		if (result.applied > 0) {
			seriesPart = { state: 'done', text: appliedTitle([offer]) };
			return;
		}
		const refusal = result.refused[0];
		seriesPart = {
			state: 'failed',
			message: templateRefusedText(offer.title, refusal?.reason ?? CHANGE_TEXTS.seriesLost),
			retry: true
		};
	}

	/** Runs the parts that were wanted and are not done; closes once all of them are. */
	async function run(parts: { transfer: boolean; series: boolean }): Promise<void> {
		busy = true;
		try {
			if (parts.transfer && transferPart.state !== 'done') await sendTransfer();
			if (parts.series && seriesOffer !== null && seriesPart.state !== 'done') {
				await sendSeries(seriesOffer);
			}
		} finally {
			busy = false;
		}
		const transferDone = !parts.transfer || transferPart.state === 'done';
		const seriesDone = !parts.series || seriesPart.state === 'done';
		if (transferDone && seriesDone) onclose();
	}

	/** What the dialog sent last: "Erneut versuchen" repeats only the failed part of it. */
	let wanted = { transfer: false, series: false };

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !ready) return;
		wanted = { transfer: wantsTransfer, series: wantsSeries };
		if (wanted.transfer) transferPart = IDLE;
		if (wanted.series) seriesPart = IDLE;
		await run(wanted);
	}

	function retry(part: 'transfer' | 'series') {
		if (busy) return;
		void run({
			transfer: wanted.transfer && (part === 'transfer' || transferPart.state !== 'done'),
			series: wanted.series && (part === 'series' || seriesPart.state !== 'done')
		});
	}
</script>

{#snippet restartHint()}
	<SectionMessage tone="info" live>
		{TRANSFER_TEXTS.restart}
		{#snippet actions()}
			<PcOnly need="pc" inline>
				<a href={resolve('/einstellungen/system')}>{TRANSFER_TEXTS.systemLink}</a>
			</PcOnly>
		{/snippet}
	</SectionMessage>
{/snippet}

{#snippet partMessage(part: Part, which: 'transfer' | 'series')}
	{#if part.state === 'done' && locked}
		<SectionMessage tone="success" compact>{part.text}</SectionMessage>
	{:else if part.state === 'failed' && locked && part.retry}
		<!-- The other part is done: only this one goes again. -->
		<SectionMessage tone="error" live>
			{part.message}
			{#snippet actions()}
				<button
					class="button-subtle"
					type="button"
					aria-busy={busy ? 'true' : undefined}
					aria-disabled={busy ? 'true' : undefined}
					onclick={() => retry(which)}>{TRANSFER_TEXTS.retry}</button
				>
			{/snippet}
		</SectionMessage>
	{:else if part.state === 'failed'}
		<SectionMessage tone="error" live>{part.message}</SectionMessage>
	{/if}
{/snippet}

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={submit}>
		<p id={describedId}>
			{after === null ? TRANSFER_TEXTS.describe(shown.key) : CHANGE_TEXTS.describe(shown.key)}
		</p>
		{#if support === 'missing'}
			{@render restartHint()}
		{:else}
			{#if support === 'failed'}
				<SectionMessage tone="error" compact live>
					{TRANSFER_TEXTS.problem(store.supportProblem ?? '')}
					{#snippet actions()}
						<button
							class="button-subtle"
							type="button"
							aria-busy={store.supportLoading ? 'true' : undefined}
							onclick={() => {
								if (!store.supportLoading) void store.loadSupport();
							}}>{TRANSFER_TEXTS.retry}</button
						>
					{/snippet}
				</SectionMessage>
			{:else if support === 'pending'}
				<p class="hint" role="status">{TRANSFER_TEXTS.loading}</p>
			{/if}

			<fieldset class="group" disabled={locked || mode === 'none'}>
				<legend>{TRANSFER_TEXTS.fields}</legend>
				{#each offers as offer (offer.field)}
					{@const described = offer.locked ?? offer.hint}
					<label class="choice">
						<input
							type="checkbox"
							value={offer.field}
							bind:group={chosen}
							disabled={offer.locked !== null}
							aria-describedby={described === null ? undefined : hintId(offer.field)}
						/>
						<span>{offer.label}: <span class="value">{offer.value}</span></span>
					</label>
					{#if described !== null}
						<p class="hint nested" id={hintId(offer.field)}>{described}</p>
					{/if}
					{#if offer.field === 'due' && shift !== null}
						<fieldset class="group nested" disabled={!chosen.includes('due')}>
							<legend class="visually-hidden">{CHANGE_TEXTS.dueChoice}</legend>
							<label class="choice">
								<input type="radio" name={`${uid}-due`} value="same" bind:group={dueChoice} />
								{CHANGE_TEXTS.sameDue}
							</label>
							<label class="choice">
								<input
									type="radio"
									name={`${uid}-due`}
									value="shift"
									bind:group={dueChoice}
									aria-describedby={shiftHintId}
								/>
								{shiftLabel(shift)}
							</label>
							<p class="hint nested" id={shiftHintId}>{CHANGE_TEXTS.keepWithout}</p>
						</fieldset>
					{/if}
				{/each}
			</fieldset>

			<fieldset class="group" disabled={locked}>
				<legend>{TRANSFER_TEXTS.target}</legend>
				<label class="choice">
					<input type="radio" name={`${uid}-target`} value="open" bind:group={mode} />
					{TRANSFER_TEXTS.allOpen(openCount)}
				</label>
				{#if seriesOffer !== null}
					<label class="choice">
						<input type="radio" name={`${uid}-target`} value="none" bind:group={mode} />
						{CHANGE_TEXTS.none}
					</label>
				{/if}
				<label class="choice">
					<input type="radio" name={`${uid}-target`} value="chosen" bind:group={mode} />
					{TRANSFER_TEXTS.choose}
				</label>
				{#if mode === 'chosen'}
					<fieldset class="group nested">
						<legend class="visually-hidden">{TRANSFER_TEXTS.chosenList}</legend>
						{#each subtasks as child (child.id)}
							<label class="choice target" class:done={!isOpenSubtask(child)}>
								<input type="checkbox" value={child.id} bind:group={chosenIds} />
								<span class="target-text">
									<span class="key">{child.key}</span>
									<span>{child.title}</span>
									{#if !isOpenSubtask(child)}
										<Lozenge label={TRANSFER_TEXTS.done} icon="check" tone="muted" />
									{/if}
								</span>
							</label>
						{/each}
					</fieldset>
				{/if}
			</fieldset>
		{/if}

		{#if seriesOffer !== null}
			<div class="group">
				<label class="choice">
					<input
						type="checkbox"
						bind:checked={seriesChecked}
						disabled={locked}
						aria-describedby={seriesHintId}
					/>
					<span>{CHANGE_TEXTS.series}</span>
				</label>
				<p class="hint nested" id={seriesHintId}>{seriesHint(seriesOffer)}</p>
			</div>
		{/if}

		{#if support !== 'missing'}
			<p class="summary" id={summaryId} aria-live="polite">{summaryLine}</p>
		{/if}
		{@render partMessage(transferPart, 'transfer')}
		{@render partMessage(seriesPart, 'series')}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		{locked ? CHANGE_TEXTS.close : TRANSFER_TEXTS.cancel}
	</button>
	{#if submitShown}
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={busy || !ready ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
			aria-describedby={support === 'missing' ? undefined : summaryId}
		>
			{busy ? (wantsTransfer ? TRANSFER_TEXTS.busy : CHANGE_TEXTS.seriesBusy) : submitText}
		</button>
	{/if}
{/snippet}

{#if inline}
	<InlineDialog
		open
		title={TRANSFER_TEXTS.title}
		describedBy={describedId}
		{busy}
		{returnFocus}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal
		open
		size="m"
		title={TRANSFER_TEXTS.title}
		describedBy={describedId}
		{busy}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.875rem;
		font-size: var(--font-size-body);
	}

	.group {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: flex-start;
		width: fit-content;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	/* The box stays on the first line of a label that wraps (340 px). */
	.choice > input {
		flex: none;
		margin-top: 0.125rem;
	}

	.value {
		font-weight: 500;
	}

	.nested {
		margin-left: 1.375rem;
	}

	.target-text {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* Done sub-tasks step back (CLAUDE.md section 8). */
	.done .target-text {
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.summary {
		font-weight: 500;
	}
</style>
