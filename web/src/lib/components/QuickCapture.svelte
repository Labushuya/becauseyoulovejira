<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { describeQuickEntry, parseQuickEntry, type QuickEntry } from '$lib/domain/quick-syntax';
	import type { CaptureTarget } from '$lib/domain/templates';
	import type { ProjectRef, TagRef } from '$lib/domain/ticket';
	import { helpHref } from '$lib/settings-sections';
	import type { CaptureSaveResult } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';

	// Quick entry (CLAUDE.md section 7; E4 plan, package 6; OF-E4-3) on the modal building block
	// (ADR-0025 section 3, size M), shown while the component is mounted: one line with the short
	// syntax `Titel @CODE !hoch #tag`, a preview of what was recognised, Enter creates a ticket
	// (source "quick"), Alt+Enter puts the line into the inbox. After saving the field empties for
	// the next line and the result is announced with a link. Typed text counts as unsaved: ×,
	// Escape and "Abbrechen" ask before it is lost. The modal returns the focus on closing.
	let {
		projects = [],
		tags = [],
		onsave,
		onclose,
		resultHref
	}: {
		/** Every project of the catalog (archived ones give a hint). */
		projects?: readonly ProjectRef[];
		tags?: readonly TagRef[];
		onsave: (entry: QuickEntry, target: CaptureTarget) => Promise<CaptureSaveResult>;
		onclose: () => void;
		resultHref: (target: CaptureTarget, id: string) => ResolvedPathname;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		input: `${uid}-input`,
		preview: `${uid}-preview`,
		hint: `${uid}-hint`
	};

	let input = $state<HTMLInputElement>();
	let text = $state('');
	let pending = $state(false);
	/** Something was saved in this dialog: the footer says "Schließen" instead of "Abbrechen". */
	let saved = $state(false);
	let message = $state<string | null>(null);
	let result = $state<{ text: string; href: ResolvedPathname; target: CaptureTarget } | null>(null);

	const entry = $derived(parseQuickEntry(text, projects, tags));
	const recognised = $derived(describeQuickEntry(entry));

	async function save(target: CaptureTarget) {
		if (pending) return;
		message = null;
		result = null;
		if (entry.title === '') {
			message = 'Der Titel darf nicht leer sein.';
			input?.focus();
			return;
		}
		pending = true;
		const outcome = await onsave(entry, target);
		pending = false;
		if (!outcome.ok) {
			message = outcome.message;
			return;
		}
		saved = true;
		result = { text: outcome.message, href: resultHref(target, outcome.id), target };
		text = '';
		input?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		void save(event.altKey ? 'inbox' : 'ticket');
	}
</script>

<Modal
	open
	size="m"
	title="Schnellerfassung"
	busy={pending}
	dirty={text.trim() !== ''}
	initialFocus={input}
	discardText="Der getippte Text geht verloren."
	onclose={() => onclose()}
>
	<form
		id={ids.form}
		class="form"
		novalidate
		onsubmit={(event) => {
			event.preventDefault();
			void save('ticket');
		}}
	>
		<label for={ids.input}>Titel mit Kurzsyntax</label>
		<input
			id={ids.input}
			type="text"
			autocomplete="off"
			aria-describedby={`${ids.preview} ${ids.hint}`}
			bind:value={text}
			bind:this={input}
			{onkeydown}
		/>
		<div class="preview" id={ids.preview} aria-live="polite">
			{#if recognised.length > 0}
				<ul>
					{#each recognised as part (part)}
						<li>{part}</li>
					{/each}
				</ul>
			{/if}
			{#each entry.hints as hint (hint)}
				<p class="note">{hint}</p>
			{/each}
		</div>
		<p class="hint" id={ids.hint}>
			Enter legt ein Ticket an, Alt+Enter legt es in den Eingang. Beispiel: „Zahnarzt anrufen @HAUS
			!hoch #anruf“ (Priorität !niedrig, !mittel, !hoch, !dringend oder !1 bis !4).
			<!-- A new tab, so typed text is never lost (plan UI-4) and the dialog stays as it is. -->
			<a href={helpHref('kurzsyntax')} target="_blank" rel="noopener">
				Mehr zur Kurzsyntax<span class="visually-hidden"> (öffnet in neuem Tab)</span>
			</a>
		</p>

		<div aria-live="polite">
			{#if result}
				<p class="result">
					{result.text}
					<a href={result.href} onclick={() => onclose()}>
						{result.target === 'ticket' ? 'Ticket ansehen' : 'Eintrag ansehen'}
					</a>
				</p>
			{/if}
		</div>
		<div aria-live="assertive">
			{#if message}
				<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
			{/if}
		</div>
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>
			{saved ? 'Schließen' : 'Abbrechen'}
		</button>
		<button
			class="button-secondary"
			type="button"
			aria-disabled={pending ? 'true' : undefined}
			onclick={() => save('inbox')}
		>
			In den Eingang
		</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={pending ? 'true' : undefined}
		>
			{pending ? 'Wird gespeichert …' : 'Ticket anlegen'}
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

	input {
		width: 100%;
		padding: 0.5rem 0.625rem;
		font: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.preview ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0;
		font-size: 0.8125rem;
		list-style: none;
	}

	.hint,
	.note {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.result {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}

	.result a,
	.hint a {
		color: var(--color-brand-text);
	}
</style>
