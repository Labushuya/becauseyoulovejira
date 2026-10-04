<script lang="ts">
	import { tick, untrack } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import Field from '$lib/components/form/Field.svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';
	import { ACCOUNTS_TEXTS, type OrphanHousehold } from '$lib/domain/accounts';
	import {
		DISSOLVE_TEXTS,
		dissolveCountLines,
		nameConfirmed,
		type HouseholdCounts
	} from '$lib/domain/area-move';
	import type { AccountsStore } from '$lib/stores/accounts.svelte';

	// "Haushalt löschen …" on the page "Konten verwalten" (E7-4c, ADR-0061 addendum E7-4c): only for
	// an orphaned household, in which no member has an account any more. The preview of the server
	// counts what it holds; deleting needs the name of the household typed and deletes everything for
	// good, with the logic of dissolving with "delete". Nobody takes the data over, the administrator
	// neither. Modal M; a refusal stands in the dialog, success closes it with a flag.
	let {
		store,
		household,
		onclose
	}: {
		store: AccountsStore;
		household: OrphanHousehold;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const holdsId = `${uid}-holds`;

	let counts = $state.raw<HouseholdCounts | null>(null);
	let loading = $state(true);
	let typed = $state('');
	let nameError = $state('');
	let message = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement>();

	const busy = $derived(store.busy?.kind === 'delete');
	const lines = $derived(counts === null ? [] : dissolveCountLines(counts));

	// The preview of the household this dialog is for.
	$effect(() => {
		const target = household;
		const controller = new AbortController();
		untrack(() => void load(target, controller.signal));
		return () => controller.abort();
	});

	async function load(target: OrphanHousehold, signal: AbortSignal) {
		loading = true;
		const outcome = await store.householdDeletePreview(target, signal);
		if (signal.aborted) return;
		loading = false;
		if (outcome.ok) {
			counts = outcome.counts;
			message = null;
		} else if (outcome.message !== '') {
			message = outcome.message;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || loading || counts === null) return;
		message = null;
		if (!nameConfirmed(typed, household.name)) {
			nameError = DISSOLVE_TEXTS.nameError;
			await tick();
			nameInput?.focus();
			return;
		}
		const outcome = await store.deleteHousehold(household, typed);
		if (outcome.ok) {
			onclose();
			return;
		}
		message = outcome.message === '' ? null : outcome.message;
	}
</script>

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		Abbrechen
	</button>
	<button
		class="button-primary"
		type="submit"
		form={formId}
		aria-disabled={busy || loading || counts === null}
		aria-busy={busy ? 'true' : undefined}
	>
		{busy ? ACCOUNTS_TEXTS.deleteRunning : ACCOUNTS_TEXTS.deleteConfirm}
	</button>
{/snippet}

<Modal
	open
	size="m"
	title={ACCOUNTS_TEXTS.deleteTitle(household.name)}
	{busy}
	onclose={() => onclose()}
	footer={buttons}
>
	<form id={formId} class="form" novalidate onsubmit={submit}>
		<p class="note">{ACCOUNTS_TEXTS.deleteText}</p>
		{#if counts === null}
			{#if loading}
				<p class="note" role="status">Vorschau wird geladen …</p>
			{/if}
		{:else}
			<section class="part" aria-labelledby={holdsId}>
				<h3 id={holdsId}>{DISSOLVE_TEXTS.holds}</h3>
				{#if lines.length === 0}
					<p class="note">{DISSOLVE_TEXTS.nothing}</p>
				{:else}
					<ul class="lines">
						{#each lines as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<Field label={DISSOLVE_TEXTS.nameLabel(household.name)} error={nameError}>
			{#snippet control(field)}
				<input
					{...field}
					type="text"
					autocomplete="off"
					maxlength="100"
					bind:this={nameInput}
					bind:value={typed}
					oninput={() => (nameError = '')}
				/>
			{/snippet}
		</Field>

		{#if message !== null}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</form>
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}

	.part {
		display: grid;
		gap: 0.375rem;
	}

	h3 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.lines {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding-left: 1.25rem;
		font-size: var(--font-size-body);
	}

	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
