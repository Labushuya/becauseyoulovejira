<script lang="ts">
	import { untrack } from 'svelte';
	import { clipboardDrafts, textLines } from '$lib/clipboard';
	import type { InboxDraft } from '$lib/domain/inbox';
	import { draftsSummary, type DraftsOutcome } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';

	// Text from the clipboard into the inbox (E4 plan, package 6) on the modal building block
	// (ADR-0025 section 3, size M): the text stays editable, the first line becomes the title and
	// the rest the text, or with "Jede Zeile als eigener Eintrag" one entry per line (at most 100).
	// Failures stay listed with their reason, and the footer then says "Schließen", because some
	// entries are saved already. The modal returns the focus on closing.
	let {
		text: initialText,
		onsave,
		onclose
	}: {
		/** Text read from the clipboard or pasted with Ctrl+V. */
		text: string;
		onsave: (drafts: InboxDraft[]) => Promise<DraftsOutcome>;
		onclose: (outcome: DraftsOutcome | null) => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		text: `${uid}-text`,
		preview: `${uid}-preview`
	};

	let area = $state<HTMLTextAreaElement>();
	let text = $state(untrack(() => initialText));
	let eachLine = $state(false);
	let pending = $state(false);
	let outcome = $state<DraftsOutcome | null>(null);

	const lineCount = $derived(textLines(text).length);
	const planned = $derived(clipboardDrafts(text, { eachLine }));
	const preview = $derived(
		!planned.ok
			? null
			: planned.drafts.length === 1
				? `Wird ein Eintrag: „${planned.drafts[0]?.title ?? ''}“`
				: `Werden ${planned.drafts.length} Einträge.`
	);

	async function save(event: Event) {
		event.preventDefault();
		if (pending || !planned.ok) return;
		pending = true;
		const result = await onsave(planned.drafts);
		pending = false;
		if (result.failures.length === 0) {
			onclose(result);
			return;
		}
		outcome = result;
	}
</script>

<Modal
	open
	size="m"
	title="Aus der Zwischenablage"
	busy={pending}
	initialFocus={area}
	onclose={() => onclose(outcome)}
>
	<form id={ids.form} class="form" novalidate onsubmit={save}>
		<label for={ids.text}>Text</label>
		<textarea
			id={ids.text}
			rows="6"
			aria-describedby={ids.preview}
			aria-invalid={!planned.ok && text.trim() !== '' ? 'true' : undefined}
			bind:value={text}
			bind:this={area}></textarea>
		<label class="check">
			<input type="checkbox" bind:checked={eachLine} />
			Jede Zeile als eigener Eintrag ({lineCount === 1 ? '1 Zeile' : `${lineCount} Zeilen`})
		</label>
		<div id={ids.preview} aria-live="polite">
			{#if planned.ok}
				<p class="hint">{preview}</p>
			{:else}
				<p class="field-error"><ErrorIcon /><span>{planned.message}</span></p>
			{/if}
		</div>

		{#if outcome !== null}
			<div class="alert-error" role="alert">
				<ErrorIcon />
				<div>
					<p>{draftsSummary(outcome)}</p>
					<ul>
						{#each outcome.failures as failure, index (index)}
							<li>„{failure.title}“: {failure.message}</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>
			{outcome === null ? 'Abbrechen' : 'Schließen'}
		</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={pending || !planned.ok ? 'true' : undefined}
		>
			{pending ? 'Wird übernommen …' : 'In den Eingang'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.625rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.check {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		color: var(--color-text);
		cursor: pointer;
	}

	textarea {
		width: 100%;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
