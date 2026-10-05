<script lang="ts">
	import { tick, untrack } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import Field from '$lib/components/form/Field.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import Modal from '$lib/components/overlay/Modal.svelte';
	import {
		DISSOLVE_TEXTS,
		assigneesClearedText,
		dissolveCountLines,
		nameConfirmed,
		type DissolveMode,
		type DissolvePreview
	} from '$lib/domain/area-move';
	import type { HouseholdStore } from '$lib/stores/household.svelte';

	// "Haushalt auflösen …" (E7-4, ADR-0061 §5), only for the owner: the preview of the server (what
	// the household holds, its members, the codes that get a suffix) and the two ways, everything into
	// the own private area or everything deleted for good; deleting needs the name of the household
	// typed. Modal M on the page "Einstellungen → Haushalt"; a refusal stands in the dialog. Afterwards
	// the household is gone: the store says so, and the area of the tab becomes "Privat". Since PL-2
	// "übernehmen" warns when tickets or rules lose their assignee in the private area.
	let {
		store,
		name,
		onclose
	}: {
		store: HouseholdStore;
		/** Name of the household, to type for deleting. */
		name: string;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const ids = {
		holds: `${uid}-holds`,
		members: `${uid}-members`,
		adopt: `${uid}-adopt-hint`,
		remove: `${uid}-remove-hint`
	};

	let mode = $state<DissolveMode>('adopt');
	let preview = $state.raw<DissolvePreview | null>(null);
	let loading = $state(true);
	let typed = $state('');
	let nameError = $state('');
	let message = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement>();

	const busy = $derived(store.busy?.kind === 'dissolve');
	const lines = $derived(preview === null ? [] : dissolveCountLines(preview.counts));
	/** Only the preview of "übernehmen" counts them; the one of "löschen" names none. */
	const assigneesCleared = $derived(
		mode === 'adopt' && preview !== null && preview.mode === 'adopt'
			? assigneesClearedText(preview.assigneesCleared)
			: null
	);

	// The preview of the chosen way (the codes with a suffix only for "übernehmen").
	$effect(() => {
		const chosen = mode;
		const controller = new AbortController();
		untrack(() => void load(chosen, controller.signal));
		return () => controller.abort();
	});

	async function load(chosen: DissolveMode, signal: AbortSignal) {
		loading = true;
		const outcome = await store.dissolvePreview(chosen, signal);
		if (signal.aborted) return;
		loading = false;
		if (outcome.ok) {
			preview = outcome.preview;
			message = null;
		} else if (outcome.message !== '') {
			message = outcome.message;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || loading || preview === null) return;
		message = null;
		if (mode === 'delete' && !nameConfirmed(typed, name)) {
			nameError = DISSOLVE_TEXTS.nameError;
			await tick();
			nameInput?.focus();
			return;
		}
		const outcome = await store.dissolve(mode, typed);
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
		aria-disabled={busy || loading || preview === null}
		aria-busy={busy ? 'true' : undefined}
	>
		{busy ? DISSOLVE_TEXTS.running : DISSOLVE_TEXTS.confirm[mode]}
	</button>
{/snippet}

<Modal
	open
	size="m"
	title={DISSOLVE_TEXTS.title(name)}
	{busy}
	onclose={() => onclose()}
	footer={buttons}
>
	<form id={formId} class="form" novalidate onsubmit={submit}>
		{#if preview === null}
			{#if loading}
				<p class="note" role="status">Vorschau wird geladen …</p>
			{/if}
		{:else}
			<section class="part" aria-labelledby={ids.holds}>
				<h3 id={ids.holds}>{DISSOLVE_TEXTS.holds}</h3>
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
			<section class="part" aria-labelledby={ids.members}>
				<h3 id={ids.members}>{DISSOLVE_TEXTS.members}</h3>
				<ul class="lines">
					{#each preview.members as member, index (index)}
						<li>
							{member.name.trim() === '' ? 'Konto ohne Namen' : member.name}
							{member.self ? '(du)' : ''}
							{member.role === 'owner' ? '· Inhaber' : ''}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<fieldset class="group">
			<legend>{DISSOLVE_TEXTS.modeLegend}</legend>
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-mode`}
					value="adopt"
					bind:group={mode}
					aria-describedby={ids.adopt}
				/>
				{DISSOLVE_TEXTS.adopt}
			</label>
			<p class="note nested" id={ids.adopt}>{DISSOLVE_TEXTS.adoptHint}</p>
			{#if mode === 'adopt' && preview !== null && preview.codes.length > 0}
				<div class="nested">
					<p class="note">{DISSOLVE_TEXTS.codes}</p>
					<ul class="lines">
						{#each preview.codes as entry (entry.id)}
							<li>{entry.name}: {entry.code} → {entry.suggestion}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-mode`}
					value="delete"
					bind:group={mode}
					aria-describedby={ids.remove}
				/>
				{DISSOLVE_TEXTS.remove}
			</label>
			<p class="note nested" id={ids.remove}>{DISSOLVE_TEXTS.removeHint}</p>
		</fieldset>

		{#if assigneesCleared !== null}
			<SectionMessage tone="warning">{assigneesCleared}</SectionMessage>
		{/if}

		{#if mode === 'delete'}
			<Field label={DISSOLVE_TEXTS.nameLabel(name)} error={nameError}>
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
		{/if}

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

	h3,
	legend {
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

	.group {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		font-size: var(--font-size-body);
	}

	.nested {
		margin-left: 1.375rem;
	}

	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
