<script lang="ts">
	import { tick } from 'svelte';
	import { MOVE_TEXTS, countLines, noteLines, ticketSourceLine } from '$lib/domain/area-move';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { AreaMoveStore } from '$lib/stores/area-move.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Field from './form/Field.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "In den Haushalt verschieben …" / "Ins Private verschieben …" (E7-4, ADR-0061): the preview of the
	// server with what moves (count per kind) and what changes, the choices it needs (the project in
	// the target, what happens to dependencies and, since QT-1 (ADR-0067), to links of source and
	// follow-up tickets with tickets that stay behind, new codes of projects whose code the target
	// has), and the hint for the people of the household. In the layout a modal
	// M; inside a modal (the full view) the same form stands inline (InlineDialog, ADR-0025 addendum
	// 16). Nothing moves before the button; a refusal of the server stands in the dialog. Since MV-2 a
	// rule, a ticket of a series and the bulk action offer "Ganze Serie verschieben" (or "Bei
	// wiederkehrenden Tickets die ganze Serie mitnehmen") with "Bisherige erledigte Vorkommen
	// mitnehmen (N)", both chosen; each change loads the preview anew.
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
		dependencies: `${uid}-dependencies`,
		dependenciesError: `${uid}-dependencies-error`,
		ticketSources: `${uid}-ticket-sources`,
		ticketSourcesError: `${uid}-ticket-sources-error`,
		series: `${uid}-series`
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
	/** "Ganze Serie verschieben" (MV-2), when a record of the request belongs to a series. */
	const offer = $derived(store.seriesOffer);
	const seriesOn = $derived(store.choices.series === true);

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

			{#if offer !== null && request !== null}
				<fieldset class="group">
					<legend>{MOVE_TEXTS.seriesLegend}</legend>
					<label class="choice">
						<input
							type="checkbox"
							checked={seriesOn}
							aria-describedby={ids.series}
							onchange={(event) => store.chooseSeries(event.currentTarget.checked)}
						/>
						{request.series === 'whole' ? MOVE_TEXTS.series : MOVE_TEXTS.seriesEach}
					</label>
					<p class="note nested" id={ids.series}>
						{seriesOn ? MOVE_TEXTS.seriesHint : MOVE_TEXTS.seriesOffHint}
					</p>
					{#if seriesOn && offer.done > 0}
						<label class="choice nested">
							<input
								type="checkbox"
								checked={store.choices.seriesDone === true}
								onchange={(event) => store.chooseSeriesDone(event.currentTarget.checked)}
							/>
							{MOVE_TEXTS.seriesDone(offer.done)}
						</label>
					{/if}
				</fieldset>
			{/if}

			{#if project !== null}
				<Field
					label={MOVE_TEXTS.projectLegend}
					hint={MOVE_TEXTS.projectHint(codesOfProject)}
					error={errors.project ?? ''}
				>
					{#snippet control(field)}
						<select
							{...field}
							value={store.choices.project ?? UNCHOSEN}
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
					{/snippet}
				</Field>
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

			{#if store.ticketSources.length > 0}
				<fieldset
					class="group"
					role="radiogroup"
					aria-invalid={errors.ticketSources ? 'true' : undefined}
					aria-describedby={errors.ticketSources ? ids.ticketSourcesError : ids.ticketSources}
					tabindex="-1"
				>
					<legend>{MOVE_TEXTS.ticketSourceLegend}</legend>
					<ul class="lines" id={ids.ticketSources}>
						{#each store.ticketSources as entry, index (index)}
							<li>{ticketSourceLine(entry)}</li>
						{/each}
					</ul>
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-ticket-sources`}
							checked={store.choices.ticketSources === 'take'}
							onchange={() => store.chooseTicketSources('take')}
						/>
						{MOVE_TEXTS.takeSources}
					</label>
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-ticket-sources`}
							checked={store.choices.ticketSources === 'release'}
							onchange={() => store.chooseTicketSources('release')}
						/>
						{MOVE_TEXTS.releaseSources}
					</label>
					{#if errors.ticketSources}
						<p class="field-error" id={ids.ticketSourcesError}>
							<ErrorIcon /><span>{errors.ticketSources}</span>
						</p>
					{/if}
				</fieldset>
			{/if}

			{#each preview.conflicts.codes as entry (entry.id)}
				<Field
					label={`${MOVE_TEXTS.codeLegend} für „${entry.name}“`}
					hint={MOVE_TEXTS.codeHint(entry.code)}
					error={errors[`code:${entry.id}`] ?? ''}
					width="auto"
				>
					{#snippet control(field)}
						<input
							{...field}
							type="text"
							maxlength="6"
							size="8"
							autocomplete="off"
							class="input-mono code"
							value={store.choices.codes[entry.id] ?? ''}
							oninput={(event) => store.setCode(entry.id, event.currentTarget.value)}
						/>
					{/snippet}
				</Field>
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

	/* Below its checkbox, like the hints of the question "Duplizieren". */
	.nested {
		margin-left: 1.375rem;
	}

	/* Codes are capitals (domain/project.ts); the field shows them so, the store normalizes them. */
	.code {
		text-transform: uppercase;
	}
</style>
