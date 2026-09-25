<script lang="ts">
	import { tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { describeQuickEntry, parseQuickEntry, type QuickEntry } from '$lib/domain/quick-syntax';
	import type { CaptureTarget } from '$lib/domain/templates';
	import type { ProjectRef, TagRef } from '$lib/domain/ticket';
	import type { CaptureSaveResult } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';

	// Quick entry (CLAUDE.md section 7; E4 plan, package 6; OF-E4-3) as a native modal <dialog>:
	// one line with the short syntax `Titel @CODE !hoch #tag`, a preview of what was recognised,
	// Enter creates a ticket (source "quick"), Alt+Enter puts the line into the inbox. After saving
	// the field empties for the next line and the result is announced with a link; Escape closes
	// and the focus returns to where it was.
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
		heading: `${uid}-heading`,
		input: `${uid}-input`,
		preview: `${uid}-preview`,
		hint: `${uid}-hint`
	};

	let dialog = $state<HTMLDialogElement>();
	let input = $state<HTMLInputElement>();
	let text = $state('');
	let pending = $state(false);
	let message = $state<string | null>(null);
	let result = $state<{ text: string; href: ResolvedPathname; target: CaptureTarget } | null>(null);

	const entry = $derived(parseQuickEntry(text, projects, tags));
	const recognised = $derived(describeQuickEntry(entry));

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		const previous = document.activeElement;
		if (!element.open) element.showModal();
		void tick().then(() => input?.focus());
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

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
		result = { text: outcome.message, href: resultHref(target, outcome.id), target };
		text = '';
		input?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		void save(event.altKey ? 'inbox' : 'ticket');
	}

	/** Escape of the browser: close unless a save runs. */
	function oncancel(event: Event) {
		event.preventDefault();
		if (!pending) onclose();
	}
</script>

<dialog class="quick" bind:this={dialog} aria-labelledby={ids.heading} {oncancel}>
	<h2 id={ids.heading}>Schnellerfassung</h2>
	<form
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

		<div class="buttons">
			<button class="secondary" type="button" onclick={() => onclose()}>Schließen</button>
			<button
				class="secondary"
				type="button"
				aria-disabled={pending ? 'true' : undefined}
				onclick={() => save('inbox')}
			>
				In den Eingang
			</button>
			<button class="button-primary" type="submit" aria-disabled={pending ? 'true' : undefined}>
				{pending ? 'Wird gespeichert …' : 'Ticket anlegen'}
			</button>
		</div>
	</form>
</dialog>

<style>
	.quick {
		width: min(36rem, calc(100vw - 2rem));
		margin: 12vh auto auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.quick::backdrop {
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

	input {
		width: 100%;
		padding: 0.5rem 0.625rem;
		font: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
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

	.result a {
		color: var(--color-brand-text);
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

	[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
