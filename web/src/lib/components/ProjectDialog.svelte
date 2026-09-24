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
	import type { EditResult } from '$lib/stores/catalog-editor';
	import ErrorIcon from './ErrorIcon.svelte';

	// "Neues Projekt" and "Projekt bearbeiten" as a native modal <dialog> (E3 plan, T-11, T-12
	// and package 14), shown while the component is mounted. Name and code; when creating, the
	// code follows the name as a suggestion until the user types one. Editing also offers
	// "Archivieren" or "Aus dem Archiv holen" and, only without tickets, "Löschen …" with a
	// second step in the same dialog. Problems of the input and field errors of the server stand
	// at their field; the parent returns the focus to the button that opened the dialog.
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
		title: `${uid}-title`,
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

	let dialog = $state<HTMLDialogElement>();
	let nameInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();
	let keepButton = $state<HTMLButtonElement>();

	$effect(() => {
		const element = dialog;
		if (element === undefined || element.open) return;
		element.showModal();
		void tick().then(() => nameInput?.focus());
		return () => {
			if (element.open) element.close();
		};
	});

	function close() {
		if (!busy) onclose();
	}

	/** Escape: back from the question before deleting, else like "Abbrechen". */
	function onDialogCancel(event: Event) {
		event.preventDefault();
		if (busy) return;
		if (confirmingDelete) void stopDeleting();
		else onclose();
	}

	function onkeydown(event: KeyboardEvent) {
		// Escape stays in the dialog, the page behind must not react as well.
		if (event.key === 'Escape') event.stopPropagation();
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

<dialog
	class="project-dialog"
	bind:this={dialog}
	aria-labelledby={ids.title}
	aria-describedby={confirmingDelete ? ids.deleteText : undefined}
	aria-busy={busy}
	oncancel={onDialogCancel}
	{onkeydown}
>
	<h2 id={ids.title}>{creating ? 'Neues Projekt' : 'Projekt bearbeiten'}</h2>

	{#if confirmingDelete && project !== null}
		<p id={ids.deleteText}>
			Projekt „{project.name}“ ({project.code}) endgültig löschen? Das lässt sich nicht rückgängig
			machen.
		</p>
		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
		<div class="buttons">
			<button
				class="secondary"
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
				class="button-primary action"
				type="button"
				aria-disabled={busy}
				onclick={() => void run(ondelete)}
			>
				{busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
			</button>
		</div>
	{:else}
		<form class="form" novalidate onsubmit={save}>
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
						class="secondary"
						type="button"
						aria-disabled={busy}
						onclick={() => void run(() => onarchive(!current.archived))}
					>
						{current.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
					</button>
					{#if canDelete}
						<button
							class="secondary"
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

			<div class="buttons">
				<button class="secondary" type="button" aria-disabled={busy} onclick={close}>
					Abbrechen
				</button>
				<button class="button-primary action" type="submit" aria-disabled={busy}>
					{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
				</button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.project-dialog {
		width: min(30rem, calc(100vw - 2rem));
		margin: auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.project-dialog[open] {
		display: grid;
		gap: 0.875rem;
	}

	/* Veils the page in the background color of the mode (no extra color token). */
	.project-dialog::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
	}

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
		border-radius: 0.375rem;
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

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.action {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
