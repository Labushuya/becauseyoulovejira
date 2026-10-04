<script lang="ts">
	import { tick } from 'svelte';
	import { MOVE_TEXTS, countLines, noteLines } from '$lib/domain/area-move';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { AreaMoveStore } from '$lib/stores/area-move.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "In den Haushalt verschieben …" / "Ins Private verschieben …" (E7-4, ADR-0060): the preview of the
	// server with what moves (count per kind) and what changes, the choices it needs (the project in
	// the target, what happens to dependencies with tickets that stay behind, new codes of projects
	// whose code the target has), and the hint for the people of the household. In the layout a modal
	// M; inside a modal (the full view) the same form stands inline (InlineDialog, ADR-0025 addendum
	// 16). Nothing moves before the button; a refusal of the server stands in the dialog.
	let {
		store,
		returnFocus
	}: {
		store: AreaMoveStore;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const ids = {
		hint: `${uid}-hint`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		dependencies: `${uid}-dependencies`,
		dependenciesError: `${uid}-dependencies-error`
	};
	const inline = insideModal();
	/** Value of the first option of the project while nothing is chosen (no record ID has a dash). */
	const UNCHOSEN = '-';

	/** Errors stand at their fields after the first try to move. */
	let tried = $state(false);
	let formElement = $state<HTMLFormElement>();

	const request = $derived(store.request);
	const preview = $derived(store.preview);
	const errors = $derived(tried ? store.errors : {});
	const busy = $derived(store.state === 'running');
	const title = $derived(request === null ? '' : MOVE_TEXTS.title(request.label, request.to));
	const counts = $derived(preview === null ? [] : countLines(preview));
	const notes = $derived(preview === null ? [] : noteLines(preview));
	const project = $derived(preview?.conflicts.project ?? null);
	const codesOfProject = $derived(
		project === null ? '' : project.projects.map((entry) => entry.code).join(', ')
	);
	const ready = $derived(preview !== null && store.state === 'ready');

	async function focusFirstError() {
		await tick();
		formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!ready) return;
		tried = true;
		if (Object.keys(store.errors).length > 0) {
			await focusFirstError();
			return;
		}
		await store.run();
	}
</script>

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={submit} bind:this={formElement}>
		{#if request !== null}
			<p class="hint-line" id={ids.hint}>
				<strong>{MOVE_TEXTS.hint[request.to]}</strong>
			</p>
		{/if}
		{#if preview === null}
			{#if store.state === 'loading'}
				<p class="note" role="status">{MOVE_TEXTS.loading}</p>
			{/if}
		{:else}
			<section class="part" aria-labelledby={`${uid}-counts`}>
				<h3 id={`${uid}-counts`}>{MOVE_TEXTS.whatMoves}</h3>
				<ul class="lines">
					{#each counts as line (line)}
						<li>{line}</li>
					{/each}
				</ul>
				<p class="note">
					{preview.fromName} → {preview.toName}
				</p>
			</section>

			{#if project !== null}
				<div class="field">
					<label for={ids.project}>{MOVE_TEXTS.projectLegend}</label>
					<select
						id={ids.project}
						value={store.choices.project ?? UNCHOSEN}
						aria-invalid={errors.project ? 'true' : undefined}
						aria-describedby={errors.project
							? `${ids.projectHint} ${ids.projectError}`
							: ids.projectHint}
						onchange={(event) => {
							if (event.currentTarget.value !== UNCHOSEN) {
								store.chooseProject(event.currentTarget.value);
							}
						}}
					>
						{#if store.choices.project === null}
							<option value={UNCHOSEN} disabled>{MOVE_TEXTS.chooseProject}</option>
						{/if}
						<option value="">{MOVE_TEXTS.noProject}</option>
						{#each project.targets as target (target.id)}
							<option value={target.id}>{target.name} ({target.code})</option>
						{/each}
					</select>
					<p class="note" id={ids.projectHint}>{MOVE_TEXTS.projectHint(codesOfProject)}</p>
					{#if errors.project}
						<p class="field-error" id={ids.projectError}>
							<ErrorIcon /><span>{errors.project}</span>
						</p>
					{/if}
				</div>
			{/if}

			{#if store.dependencies.length > 0}
				<fieldset
					class="group"
					role="radiogroup"
					aria-invalid={errors.dependencies ? 'true' : undefined}
					aria-describedby={errors.dependencies ? ids.dependenciesError : ids.dependencies}
					tabindex="-1"
				>
					<legend>{MOVE_TEXTS.dependencyLegend}</legend>
					<ul class="lines" id={ids.dependencies}>
						{#each store.dependencies as entry, index (index)}
							<li>
								{entry.ticket?.key ?? '–'} ↔ {entry.other?.key ?? '–'}
								{entry.other?.title ? `„${entry.other.title}“` : ''}
							</li>
						{/each}
					</ul>
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-dependencies`}
							checked={store.choices.dependencies === 'take'}
							onchange={() => store.chooseDependencies('take')}
						/>
						{MOVE_TEXTS.take}
					</label>
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-dependencies`}
							checked={store.choices.dependencies === 'release'}
							onchange={() => store.chooseDependencies('release')}
						/>
						{MOVE_TEXTS.release}
					</label>
					{#if errors.dependencies}
						<p class="field-error" id={ids.dependenciesError}>
							<ErrorIcon /><span>{errors.dependencies}</span>
						</p>
					{/if}
				</fieldset>
			{/if}

			{#each preview.conflicts.codes as entry (entry.id)}
				{@const field = `${uid}-code-${entry.id}`}
				{@const error = errors[`code:${entry.id}`]}
				<div class="field">
					<label for={field}>{MOVE_TEXTS.codeLegend} für „{entry.name}“</label>
					<input
						id={field}
						type="text"
						maxlength="6"
						autocomplete="off"
						class="code"
						value={store.choices.codes[entry.id] ?? ''}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error ? `${field}-hint ${field}-error` : `${field}-hint`}
						oninput={(event) => store.setCode(entry.id, event.currentTarget.value)}
					/>
					<p class="note" id={`${field}-hint`}>{MOVE_TEXTS.codeHint(entry.code)}</p>
					{#if error}
						<p class="field-error" id={`${field}-error`}><ErrorIcon /><span>{error}</span></p>
					{/if}
				</div>
			{/each}

			{#if notes.length > 0}
				<section class="part" aria-labelledby={`${uid}-notes`}>
					<h3 id={`${uid}-notes`}>{MOVE_TEXTS.conflicts}</h3>
					<ul class="lines">
						{#each notes as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}

		{#if store.message !== null}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{store.message}</span></div>
		{/if}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		Abbrechen
	</button>
	{#if request !== null}
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={!ready}
			aria-busy={busy ? 'true' : undefined}
		>
			{busy ? MOVE_TEXTS.running : MOVE_TEXTS.confirm[request.to]}
		</button>
	{/if}
{/snippet}

{#if request !== null}
	{#if inline}
		<InlineDialog
			open
			{title}
			describedBy={ids.hint}
			{busy}
			{returnFocus}
			onclose={() => store.close()}
			footer={buttons}
		>
			{@render content()}
		</InlineDialog>
	{:else}
		<Modal
			open
			size="m"
			{title}
			describedBy={ids.hint}
			{busy}
			onclose={() => store.close()}
			footer={buttons}
		>
			{@render content()}
		</Modal>
	{/if}
{/if}

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}

	.hint-line,
	.lines {
		font-size: var(--font-size-body);
	}

	.lines {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding-left: 1.25rem;
	}

	.part {
		display: grid;
		gap: 0.375rem;
	}

	h3 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.field label,
	legend {
		font-size: var(--font-size-control);
		font-weight: 600;
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

	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.code {
		font-family: var(--font-mono);
		text-transform: uppercase;
	}
</style>
