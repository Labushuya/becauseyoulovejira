<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { clipboardDrafts, textLines } from '$lib/clipboard';
	import type { InboxDraft } from '$lib/domain/inbox';
	import { draftsSummary, type DraftsOutcome } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';

	// Text from the clipboard into the inbox (E4 plan, package 6) as a native modal <dialog>: the
	// text stays editable, the first line becomes the title and the rest the text, or with "Jede
	// Zeile als eigener Eintrag" one entry per line (at most 100). Failures stay listed with their
	// reason; Escape and "Schließen" close, the focus returns to where it was.
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
		heading: `${uid}-heading`,
		text: `${uid}-text`,
		preview: `${uid}-preview`
	};

	let dialog = $state<HTMLDialogElement>();
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

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		const previous = document.activeElement;
		if (!element.open) element.showModal();
		void tick().then(() => area?.focus());
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

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

	function close() {
		if (!pending) onclose(outcome);
	}
</script>

<dialog
	class="clipboard"
	bind:this={dialog}
	aria-labelledby={ids.heading}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<h2 id={ids.heading}>Aus der Zwischenablage</h2>
	<form class="form" novalidate onsubmit={save}>
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

		<div class="buttons">
			<button class="secondary" type="button" onclick={close}>Schließen</button>
			<button
				class="button-primary"
				type="submit"
				aria-disabled={pending || !planned.ok ? 'true' : undefined}
			>
				{pending ? 'Wird übernommen …' : 'In den Eingang'}
			</button>
		</div>
	</form>
</dialog>

<style>
	.clipboard {
		width: min(36rem, calc(100vw - 2rem));
		margin: auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.clipboard::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		margin-bottom: 0.75rem;
		font-size: 1rem;
		font-weight: 600;
	}

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
		padding: 0.5rem 0.625rem;
		font: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.625rem 1rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
