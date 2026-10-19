<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
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
		type TargetChoice,
		type TransferField,
		type TransferNames
	} from '$lib/domain/subtask-transfer';
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
	let {
		parent,
		subtasks,
		store,
		names,
		onclose,
		returnFocus
	}: {
		parent: TicketSummary;
		/** All sub-tasks of the ticket, open ones first (the list of the section). */
		subtasks: readonly TicketSummary[];
		store: SubtaskTransferStore;
		/** Project, tag names and assignee of the ticket as the dialog names them. */
		names: TransferNames;
		/** Cancel, or after the transfer. */
		onclose: () => void;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;
	const summaryId = `${uid}-summary`;
	const inline = insideModal();

	/** The ticket as the dialog opened: its values are what the user confirms. */
	const shown = untrack(() => ({ ...parent }));
	const shownNames = untrack(() => ({ ...names }));
	const offers = fieldOffers(shown, shownNames);

	let chosen = $state<TransferField[]>(
		untrack(() => [...initialFields(store.rememberedFields, offers, shown)])
	);
	let mode = $state<'open' | 'chosen'>('open');
	let chosenIds = $state<string[]>(
		untrack(() => {
			const advance = chosenInAdvance(subtasks);
			return advance.mode === 'chosen' ? [...advance.ids] : [];
		})
	);
	let busy = $state(false);
	let message = $state<string | null>(null);
	/** The server answered the transfer with "unknown route" (before the restart). */
	let routeMissing = $state(false);

	const support = $derived(routeMissing ? 'missing' : store.support);
	const openCount = $derived(subtasks.filter(isOpenSubtask).length);
	const choice = $derived<TargetChoice>(
		mode === 'open' ? OPEN_TARGETS : { mode: 'chosen', ids: new Set(chosenIds) }
	);
	const fields = $derived(fieldsOf(new Set(chosen), shown));
	const targets = $derived(targetsOf(subtasks, choice));
	const summary = $derived(transferSummary(shown, targets, fields));
	const ready = $derived(support === 'ready' && hasFields(fields) && targets.length > 0);

	// Every opening asks what the server knows (unless it named everything already).
	$effect(() => untrack(() => void store.loadSupport()));

	const hintId = (field: TransferField) => `${uid}-${field}-hint`;

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !ready) return;
		message = null;
		busy = true;
		try {
			const result = await store.transfer(
				{ id: shown.id, key: shown.key },
				{
					expectedUpdated: shown.updated,
					fields,
					targets: targetsRequest(subtasks, choice)
				},
				chosen
			);
			if (result.ok) {
				onclose();
				return;
			}
			if (result.missing) routeMissing = true;
			else message = result.message;
		} finally {
			busy = false;
		}
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

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={submit}>
		<p id={describedId}>{TRANSFER_TEXTS.describe(shown.key)}</p>
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

			<fieldset class="group">
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
				{/each}
			</fieldset>

			<fieldset class="group">
				<legend>{TRANSFER_TEXTS.target}</legend>
				<label class="choice">
					<input type="radio" name={`${uid}-target`} value="open" bind:group={mode} />
					{TRANSFER_TEXTS.allOpen(openCount)}
				</label>
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

			<p class="summary" id={summaryId} aria-live="polite">{summaryText(summary)}</p>
		{/if}
		{#if message}
			<SectionMessage tone="error" live>{message}</SectionMessage>
		{/if}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		{TRANSFER_TEXTS.cancel}
	</button>
	{#if support !== 'missing'}
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={busy || !ready ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
			aria-describedby={summaryId}
		>
			{busy ? TRANSFER_TEXTS.busy : TRANSFER_TEXTS.submit}
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
