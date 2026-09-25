<script lang="ts">
	import { tick } from 'svelte';
	import {
		PROJECT_CODE_MAX_LENGTH,
		PROJECT_NAME_MAX_LENGTH,
		RESERVED_CODE,
		suggestProjectCode,
		type Project,
		type ProjectDraft
	} from '$lib/domain/project';
	import type { CloseTrigger } from '$lib/overlay/close-rules';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Neues Projekt" and "Projekt bearbeiten" (E3 plan, T-11, T-12 and package 14) on the modal
	// building block (ADR-0025 section 3, size M), shown while the component is mounted; the project
	// panel replaces it in UI-8. Name and code; when creating, the code follows the name as a
	// suggestion until the user types one. Editing also offers "Archivieren" or "Aus dem Archiv
	// holen" and, only without tickets, "Löschen …" with a second step in the same dialog (no dialog
	// from a dialog); Escape goes back from there to the form. Problems of the input and field
	// errors of the server stand at their field.
	let {
		project = null,
		total = null,
		onsave,
		onarchive,
		ondelete,
		onclose
	}: {
		/** Project to edit; null creates a new one. */
		project?: Project | null;
		/** Tickets of the project, done ones included; null while not counted. */
		total?: number | null;
		onsave: (draft: ProjectDraft) => Promise<EditResult<Project>>;
		onarchive: (archived: boolean) => Promise<EditResult<Project>>;
		ondelete: () => Promise<EditResult<void>>;
		/** Cancel, or after a successful action. */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		code: `${uid}-code`,
		codeHint: `${uid}-code-hint`,
		codeError: `${uid}-code-error`,
		deleteText: `${uid}-delete-text`
	};

	/** Typed name; null until the user types, so the name of the project shows. */
	let typedName = $state<string | null>(null);
	/** Typed code; null until the user types, so the suggestion or the code of the project shows. */
	let typedCode = $state<string | null>(null);
	let fieldErrors = $state<{ name?: string; code?: string }>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let confirmingDelete = $state(false);

	const creating = $derived(project === null);
	const name = $derived(typedName ?? project?.name ?? '');
	const code = $derived(typedCode ?? project?.code ?? suggestProjectCode(name));
	/** The hooks keep the code while tickets use the project (E1 plan, OF-14). */
	const codeFixed = $derived(!creating && total !== null && total > 0);
	const canDelete = $derived(!creating && total === 0);

	let nameInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();
	let keepButton = $state<HTMLButtonElement>();

	/** Escape in the question before deleting goes back to the form; every other way closes. */
	function requestClose(reason: CloseTrigger) {
		if (confirmingDelete && reason === 'escape') void stopDeleting();
		else onclose();
	}

	async function run<T>(action: () => Promise<EditResult<T>>): Promise<boolean> {
		if (busy) return false;
		busy = true;
		message = null;
		try {
			const result = await action();
			if (result.ok) {
				onclose();
				return true;
			}
			fieldErrors = result.fields;
			message = result.message;
			return false;
		} finally {
			busy = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		fieldErrors = {};
		const saved = await run(() => onsave({ name, code }));
		if (saved) return;
		await tick();
		if (fieldErrors.name) nameInput?.focus();
		else if (fieldErrors.code) codeInput?.focus();
	}

	async function startDeleting() {
		confirmingDelete = true;
		message = null;
		await tick();
		keepButton?.focus();
	}

	async function stopDeleting() {
		confirmingDelete = false;
		message = null;
		await tick();
		nameInput?.focus();
	}
</script>

<Modal
	open
	size="m"
	title={creating ? 'Neues Projekt' : 'Projekt bearbeiten'}
	describedBy={confirmingDelete ? ids.deleteText : undefined}
	{busy}
	initialFocus={nameInput}
	onclose={requestClose}
>
	{#if confirmingDelete && project !== null}
		<p id={ids.deleteText}>
			Projekt „{project.name}“ ({project.code}) endgültig löschen? Das lässt sich nicht rückgängig
			machen.
		</p>
		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
	{:else}
		<form id={ids.form} class="form" novalidate onsubmit={save}>
			<div class="field">
				<label for={ids.name}>Name</label>
				<input
					id={ids.name}
					type="text"
					autocomplete="off"
					maxlength={PROJECT_NAME_MAX_LENGTH}
					value={name}
					bind:this={nameInput}
					aria-invalid={fieldErrors.name ? 'true' : undefined}
					aria-describedby={fieldErrors.name ? ids.nameError : undefined}
					oninput={(event) => (typedName = event.currentTarget.value)}
				/>
				{#if fieldErrors.name}
					<p class="field-error" id={ids.nameError}><ErrorIcon /><span>{fieldErrors.name}</span></p>
				{/if}
			</div>

			<div class="field">
				<label for={ids.code}>Code</label>
				<input
					id={ids.code}
					class="code"
					type="text"
					autocomplete="off"
					spellcheck="false"
					maxlength={PROJECT_CODE_MAX_LENGTH}
					value={code}
					readonly={codeFixed}
					bind:this={codeInput}
					aria-invalid={fieldErrors.code ? 'true' : undefined}
					aria-describedby={fieldErrors.code ? `${ids.codeError} ${ids.codeHint}` : ids.codeHint}
					oninput={(event) => {
						const upper = event.currentTarget.value.toUpperCase();
						event.currentTarget.value = upper;
						typedCode = upper;
					}}
				/>
				{#if fieldErrors.code}
					<p class="field-error" id={ids.codeError}><ErrorIcon /><span>{fieldErrors.code}</span></p>
				{/if}
				<p class="hint" id={ids.codeHint}>
					{#if codeFixed}
						Der Code bleibt fest, weil Tickets das Projekt verwenden.
					{:else}
						2 bis 6 Großbuchstaben (A–Z), nicht {RESERVED_CODE}. Tickets des Projekts heißen
						{code === '' ? 'CODE' : code}-1, {code === '' ? 'CODE' : code}-2 …
						{#if creating}Der Vorschlag folgt dem Namen und lässt sich ändern.{/if}
					{/if}
				</p>
			</div>

			{#if message}
				<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
			{/if}

			{#if project !== null}
				{@const current = project}
				<div class="manage">
					<button
						class="button-secondary"
						type="button"
						aria-disabled={busy}
						onclick={() => void run(() => onarchive(!current.archived))}
					>
						{current.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
					</button>
					{#if canDelete}
						<button
							class="button-secondary"
							type="button"
							aria-disabled={busy}
							onclick={() => {
								if (!busy) void startDeleting();
							}}
						>
							Löschen …
						</button>
					{:else}
						<p class="hint">
							{total === null
								? 'Löschen ist möglich, sobald feststeht, dass kein Ticket das Projekt verwendet.'
								: 'Ein Projekt mit Tickets lässt sich nicht löschen, nur archivieren.'}
						</p>
					{/if}
				</div>
			{/if}
		</form>
	{/if}

	{#snippet footer({ close })}
		{#if confirmingDelete && project !== null}
			<button
				class="button-secondary"
				type="button"
				bind:this={keepButton}
				aria-disabled={busy}
				onclick={() => {
					if (!busy) void stopDeleting();
				}}
			>
				Abbrechen
			</button>
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy}
				onclick={() => void run(ondelete)}
			>
				{busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
			</button>
		{:else}
			<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
				Abbrechen
			</button>
			<button class="button-primary" type="submit" form={ids.form} aria-disabled={busy}>
				{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	p {
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.form {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	input {
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	input.code {
		width: 8rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
	}

	input[readonly] {
		color: var(--color-text-muted);
		background: var(--color-bg);
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.manage {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}
</style>
