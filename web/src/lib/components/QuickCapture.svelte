<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { ProblemEntry } from '$lib/domain/problems';
	import { treeOrder } from '$lib/domain/project-tree';
	import {
		describeQuickEntry,
		parseQuickEntry,
		withProjectToken,
		type QuickEntry
	} from '$lib/domain/quick-syntax';
	import type { CaptureTarget } from '$lib/domain/templates';
	import type { ProjectRef, TagRef } from '$lib/domain/ticket';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { helpHref } from '$lib/settings-sections';
	import type { CaptureSaveResult } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';
	import NewTabHint from './guidance/NewTabHint.svelte';
	import Modal from './overlay/Modal.svelte';
	import ProblemDetails from './problems/ProblemDetails.svelte';
	import ProjectSelect from './ProjectSelect.svelte';

	// Quick entry (docs/regeln/ansichten.md; E4 plan, package 6; OF-E4-3) on the modal building block
	// (ADR-0025 section 3, size M), shown while the component is mounted: one line with the short
	// syntax `Titel @CODE !hoch #tag`, a preview of what was recognised, Enter creates a ticket
	// (source "quick"), Alt+Enter puts the line into the inbox. After saving the field empties for
	// the next line and the result is announced with a link. Typed text counts as unsaved: ×,
	// Escape and "Abbrechen" ask before it is lost. The modal returns the focus on closing.
	// "Projekt" (ProjectSelect, ADR-0042 section 3) chooses the project from the list without
	// knowing its code: the choice writes `@CODE` into the line, a typed `@CODE` shows in the list.
	// The sheet of "＋" in the phone frame (MO-5, ADR-0073 addendum MO-5): the modal stands as a sheet
	// there anyway (MO-1b); the line capitalises sentences, the result and failures stand right below
	// it (above the on-screen keyboard), the help on the short syntax is folded and names no keys,
	// and the footer holds only the two buttons that save, side by side ("Ticket anlegen" as the
	// main one); the × closes. A tap on them keeps the focus in the line, so the keyboard stays open
	// for the next one. Off, or from 40rem, the dialog stays as it was.
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
		hint: `${uid}-hint`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`
	};

	/** The phone frame applies (switch on, narrow window): the sheet of "＋" (MO-5). */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);

	let input = $state<HTMLInputElement>();
	let text = $state('');
	let pending = $state(false);
	/** Something was saved in this dialog: the footer says "Schließen" instead of "Abbrechen". */
	let saved = $state(false);
	let message = $state<string | null>(null);
	/** The failed request behind `message`, for "Details" (FP-1, ADR-0071). */
	let messageProblem = $state.raw<ProblemEntry | null>(null);
	let result = $state<{ text: string; href: ResolvedPathname; target: CaptureTarget } | null>(null);

	const entry = $derived(parseQuickEntry(text, projects, tags));
	const recognised = $derived(describeQuickEntry(entry));
	/** The projects of the list: the active ones in tree order ("Haus › Garten (GART)"). */
	const activeProjects = $derived(treeOrder(projects.filter((project) => !project.archived)));

	/** A project from the list goes into the line as `@CODE`, "Kein Projekt" removes it. */
	function chooseProject(id: string) {
		const code = projects.find((project) => project.id === id)?.code ?? null;
		text = withProjectToken(text, code, projects);
	}

	async function save(target: CaptureTarget) {
		if (pending) return;
		message = null;
		result = null;
		if (entry.title === '') {
			message = 'Der Titel darf nicht leer sein.';
			messageProblem = null;
			input?.focus();
			return;
		}
		pending = true;
		const outcome = await onsave(entry, target);
		pending = false;
		if (!outcome.ok) {
			message = outcome.message;
			messageProblem = outcome.problem ?? null;
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

	/**
	 * In the phone frame a press on a button that saves leaves the focus in the line (MO-5): the
	 * on-screen keyboard stays open for the next line instead of closing and opening again. The
	 * click still runs. On the PC the button takes the focus as before.
	 */
	function keepLine(event: MouseEvent) {
		mobileLayout.keepFocus(event);
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
			enterkeyhint="done"
			autocapitalize={phone ? 'sentences' : undefined}
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
		{#if phone}
			<!-- Right below the line, above the on-screen keyboard (MO-5). -->
			{@render outcome()}
		{/if}
		<div class="project">
			<label for={ids.project}>Projekt</label>
			<ProjectSelect
				id={ids.project}
				value={entry.project?.id ?? ''}
				projects={activeProjects}
				errorId={ids.projectError}
				hintId={ids.projectHint}
				hint="Setzt @CODE in die Zeile; getipptes @CODE wählt das Projekt hier."
				onchoose={chooseProject}
			/>
		</div>
		{#if phone}
			<!-- Folded on the phone, without the keys: it has its two buttons (MO-5). -->
			<details class="capture-help">
				<summary>Hilfe zur Kurzsyntax</summary>
				<p class="hint" id={ids.hint}>{@render syntaxHelp()}</p>
			</details>
		{:else}
			<p class="hint" id={ids.hint}>
				Enter legt ein Ticket an, Alt+Enter legt es in den Eingang. {@render syntaxHelp()}
			</p>
			{@render outcome()}
		{/if}
	</form>

	{#snippet footer({ close })}
		{#if !phone}
			<button class="button-secondary" type="button" onclick={close}>
				{saved ? 'Schließen' : 'Abbrechen'}
			</button>
		{/if}
		<button
			class="button-secondary capture-save"
			type="button"
			aria-disabled={pending ? 'true' : undefined}
			onmousedown={keepLine}
			onclick={() => save('inbox')}
		>
			In den Eingang
		</button>
		<button
			class="button-primary capture-save"
			type="submit"
			form={ids.form}
			aria-disabled={pending ? 'true' : undefined}
			onmousedown={keepLine}
		>
			{pending ? 'Wird gespeichert …' : 'Ticket anlegen'}
		</button>
	{/snippet}
</Modal>

{#snippet syntaxHelp()}
	Beispiel: „Zahnarzt anrufen @HAUS !hoch #anruf“ (Priorität !niedrig, !mittel, !hoch, !dringend
	oder !1 bis !4).
	<!-- A new tab, so typed text is never lost (plan UI-4) and the dialog stays as it is. -->
	<a href={helpHref('kurzsyntax')} target="_blank" rel="noopener">
		Mehr zur Kurzsyntax<NewTabHint />
	</a>
{/snippet}

<!-- What the last save did: the result with its link, or the failure. -->
{#snippet outcome()}
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
	{#if message}
		<ProblemDetails problem={messageProblem} />
	{/if}
{/snippet}

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
	}

	.project {
		display: grid;
		gap: 0.25rem;
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

	/*
	 * The sheet of "＋" in the phone frame (MO-5, ADR-0073 addendum MO-5): the two buttons that save
	 * share the footer side by side, each at least 44 px high (base.css), and wrap one below the
	 * other only if their words do not fit; the opener of the folded help and "Ticket ansehen" are
	 * targets of 44 px as well. Off, or from 40rem, nothing changes.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .capture-save {
			flex: 1 1 0;
			white-space: nowrap;
		}

		:global(:root[data-mobile-layout='on']) .capture-help summary {
			font-size: var(--font-size-control);
			line-height: var(--control-height-touch);
			color: var(--color-text-muted);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .result {
			align-items: center;
		}

		:global(:root[data-mobile-layout='on']) .result a {
			display: inline-flex;
			align-items: center;
			min-height: var(--control-height-touch);
		}
	}
</style>
