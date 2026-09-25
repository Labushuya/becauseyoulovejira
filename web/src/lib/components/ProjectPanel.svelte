<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
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
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';

	// Project panel (ADR-0025 section 10, decision 4 of the user; plan UI-Konsistenz, package UI-8)
	// on the side panel building block, instead of the project dialog: "Neues Projekt" under
	// /projekte/neu and a project under /projekte/<id>, next to the tiles like a ticket next to the
	// table. Name and code in a form (when creating, the code follows the name as a suggestion until
	// the user types one; it stays fixed while tickets use the project); a project also shows its
	// numbers, "Tickets anzeigen" and "Archivieren" / "Aus dem Archiv holen". "Löschen …" in the
	// header only without tickets, with the confirmation (like TicketDelete); Escape and × ask
	// before unsaved input is lost. Problems of the input and field errors of the server stand at
	// their field. The owner navigates and shows the flags.
	let {
		project = null,
		active = null,
		total = null,
		fresh = 0,
		ticketsHref = null,
		onsave,
		onarchive,
		ondelete,
		onsaved,
		ondeleted,
		onclose
	}: {
		/** Project of the panel; null for "Neues Projekt". */
		project?: Project | null;
		/** Tickets of the project that are not done; null while not loaded. */
		active?: number | null;
		/** Tickets of the project, done ones included; null while not counted. */
		total?: number | null;
		/** New tickets of the project for the signed-in user. */
		fresh?: number;
		/** "Tickets anzeigen": the list filtered by the project. */
		ticketsHref?: ResolvedPathname | null;
		onsave: (draft: ProjectDraft) => Promise<EditResult<Project>>;
		/** "Archivieren" and "Aus dem Archiv holen" of a project. */
		onarchive?: (archived: boolean) => Promise<EditResult<Project>>;
		/** "Löschen …" of a project without tickets. */
		ondelete?: () => Promise<EditResult<void>>;
		/** After saving: the saved project (a new one gets its own panel). */
		onsaved?: (project: Project) => void;
		/** After deleting: back to the tiles. */
		ondeleted?: () => void;
		/** × and Escape (after the question about unsaved input). */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-title`,
		form: `${uid}-form`,
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		code: `${uid}-code`,
		codeHint: `${uid}-code-hint`,
		codeError: `${uid}-code-error`,
		archive: `${uid}-archive`
	};

	/** Typed name; null until the user types, so the name of the project shows. */
	let typedName = $state<string | null>(null);
	/** Typed code; null until the user types, so the suggestion or the code of the project shows. */
	let typedCode = $state<string | null>(null);
	let fieldErrors = $state<{ name?: string; code?: string }>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let confirmingDiscard = $state(false);

	const creating = $derived(project === null);
	const name = $derived(typedName ?? project?.name ?? '');
	const code = $derived(typedCode ?? project?.code ?? suggestProjectCode(name));
	/** The hooks keep the code while tickets use the project (E1 plan, OF-14). */
	const codeFixed = $derived(!creating && total !== null && total > 0);
	/** The hook refuses to delete a project that tickets use; archiving is the way then. */
	const canDelete = $derived(!creating && total === 0 && ondelete !== undefined);
	const dirty = $derived(
		(typedName !== null && typedName.trim() !== (project?.name ?? '')) ||
			(typedCode !== null && typedCode !== (project?.code ?? ''))
	);

	let heading = $state<HTMLElement>();
	let nameInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();

	// Focus when the panel opens: the name for "Neues Projekt", else the title (ADR-0025 section 6).
	$effect(() => {
		const target = creating ? nameInput : heading;
		if (target) untrack(() => target.focus());
	});

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}

	function close() {
		if (busy) return;
		if (dirty) confirmingDiscard = true;
		else onclose();
	}

	async function run<T>(action: () => Promise<EditResult<T>>): Promise<EditResult<T> | null> {
		if (busy) return null;
		busy = true;
		message = null;
		try {
			const result = await action();
			if (!result.ok) {
				fieldErrors = result.fields;
				message = result.message;
			}
			return result;
		} finally {
			busy = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		fieldErrors = {};
		const result = await run(() => onsave({ name, code }));
		if (result === null) return;
		if (result.ok) {
			typedName = null;
			typedCode = null;
			onsaved?.(result.value);
			return;
		}
		await tick();
		if (fieldErrors.name) nameInput?.focus();
		else if (fieldErrors.code) codeInput?.focus();
	}

	async function archive(
		change: (archived: boolean) => Promise<EditResult<Project>>,
		archived: boolean
	) {
		fieldErrors = {};
		await run(() => change(archived));
	}

	function askDelete() {
		deleteError = null;
		confirmingDelete = true;
	}

	async function remove() {
		if (deleting || ondelete === undefined) return;
		deleting = true;
		deleteError = null;
		const result = await ondelete();
		deleting = false;
		if (result.ok) {
			confirmingDelete = false;
			ondeleted?.();
		} else if (result.message !== null) {
			deleteError = result.message;
		} else {
			confirmingDelete = false;
		}
	}
</script>

<Drawer labelledby={ids.heading} closeFromFields onclose={close}>
	{#snippet context()}
		{#if project}
			<span class="context-code">{project.code}</span> · Projekt
		{:else}
			Projekte
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if canDelete}
			<button class="button-subtle" type="button" aria-haspopup="dialog" onclick={askDelete}>
				Löschen …
			</button>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if creating}
			<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		{/if}
		<button class="button-primary" type="submit" form={ids.form} aria-disabled={busy}>
			{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
		</button>
	{/snippet}

	<h2 id={ids.heading} tabindex="-1" bind:this={heading}>
		{project ? project.name : 'Neues Projekt'}
	</h2>

	{#if project}
		<div class="summary">
			{#if project.archived}
				<span class="badge">Archiviert</span>
			{/if}
			<p class="stats">
				<span><strong>{number(active)}</strong> aktiv</span>
				<span aria-hidden="true">·</span>
				<span><strong>{number(total)}</strong> gesamt</span>
				{#if fresh > 0}
					<span aria-hidden="true">·</span>
					<span class="new"><strong>{fresh}</strong> neu</span>
				{/if}
			</p>
			{#if ticketsHref}
				<a class="tickets" href={ticketsHref}>Tickets anzeigen</a>
			{/if}
		</div>
	{/if}

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
	</form>

	<div aria-live="assertive">
		{#if message}
			<div class="alert-error"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</div>

	{#if project !== null && onarchive}
		{@const current = project}
		{@const change = onarchive}
		<section class="manage" aria-labelledby={ids.archive}>
			<h3 id={ids.archive}>Archiv</h3>
			<button
				class="button-secondary"
				type="button"
				aria-disabled={busy}
				onclick={() => {
					if (!busy) void archive(change, !current.archived);
				}}
			>
				{current.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
			</button>
			{#if !canDelete}
				<p class="hint">
					{total === null
						? 'Löschen ist möglich, sobald feststeht, dass kein Ticket das Projekt verwendet.'
						: `Ein Projekt mit Tickets (${total}) lässt sich nicht löschen, nur archivieren.`}
				</p>
			{/if}
		</section>
	{/if}
</Drawer>

{#if project !== null}
	<ConfirmDialog
		open={confirmingDelete}
		title={`Projekt „${project.name}“ löschen?`}
		confirmLabel="Endgültig löschen"
		busy={deleting}
		error={deleteError}
		onconfirm={remove}
		oncancel={() => {
			confirmingDelete = false;
			deleteError = null;
		}}
	>
		<p>
			„{project.name}“ ({project.code}) hat keine Tickets. Das Projekt wird endgültig gelöscht; das
			lässt sich nicht rückgängig machen.
		</p>
	</ConfirmDialog>
{/if}

<ConfirmDialog
	open={confirmingDiscard}
	title={creating ? 'Neues Projekt verwerfen?' : 'Änderungen verwerfen?'}
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		onclose();
	}}
	oncancel={() => (confirmingDiscard = false)}
>
	<p>Die Eingaben gehen verloren.</p>
</ConfirmDialog>

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	p {
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.context-code {
		font-family: var(--font-mono);
		color: var(--color-brand-text);
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.badge {
		padding: 0 0.5rem;
		font-size: 0.75rem;
		line-height: 1.25rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.625rem;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.stats strong {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.stats .new,
	.stats .new strong {
		color: var(--color-brand-text);
	}

	.tickets {
		font-size: 0.875rem;
		color: var(--color-brand-text);
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
		max-width: 100%;
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
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		padding-top: 1rem;
		border-top: 1px solid var(--color-line);
	}
</style>
