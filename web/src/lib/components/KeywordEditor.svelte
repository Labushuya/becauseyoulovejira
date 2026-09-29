<script lang="ts">
	import { tick } from 'svelte';
	import {
		KEYWORD_MAX_LENGTH,
		KEYWORD_SUGGESTIONS,
		planKeywordAdditions,
		withSuggestions
	} from '$lib/domain/keywords';
	import {
		hasListSeparator,
		listInputAction,
		splitAtCaret,
		splitListInput
	} from '$lib/domain/list-input';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// List of keywords (ADR-0020; E4 plan package 20): add, remove, take over the suggestions. Every
	// change is saved at once through `onsave`, which answers with an error text or null. Without
	// keywords a neutral warning says what that means (`emptyText`), as a compact section message of
	// the tone "warning" (plan EH-10): icon and hidden "Achtung:", no yellow.
	// Input (user feedback, package A): a comma, Enter and pasting a comma-separated list take the
	// text as keywords and empty the field; Backspace in the empty field brings the last keyword back
	// as editable text. What happens to the field is said in a polite live region. The rules of the
	// field are shared with the tag picker (domain/list-input.ts).
	let {
		keywords,
		name,
		description,
		emptyText,
		onsave
	}: {
		keywords: readonly string[];
		/** Name of the list for labels, e.g. „Google Kalender“. */
		name: string;
		/** Where the keywords are searched. */
		description: string;
		/** Shown while the list is empty. */
		emptyText: string;
		onsave: (next: string[], announcement: string) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const ids = {
		legend: `${uid}-legend`,
		input: `${uid}-input`,
		inputError: `${uid}-input-error`,
		hint: `${uid}-hint`,
		keys: `${uid}-keys`
	};

	let input = $state('');
	let inputError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let field = $state<HTMLInputElement>();
	let live = $state('');

	const suggestionsMissing = $derived(withSuggestions(keywords).length > keywords.length);

	async function save(next: string[], announcement: string): Promise<boolean> {
		if (saving) return false;
		saving = true;
		saveError = null;
		const error = await onsave(next, announcement);
		saving = false;
		saveError = error;
		return error === null;
	}

	async function remove(keyword: string) {
		inputError = null;
		const next = keywords.filter((entry) => entry !== keyword);
		// The button disappears with the keyword; the focus goes to the input field.
		field?.focus();
		await save(next, `Stichwort „${keyword}“ entfernt.`);
	}

	async function suggest() {
		inputError = null;
		const next = withSuggestions(keywords);
		const added = next.length - keywords.length;
		if (added === 0) return;
		await save(next, `${added} ${added === 1 ? 'Vorschlag' : 'Vorschläge'} übernommen.`);
	}

	/** Says `text` in the live region, also when it is the same text as before. */
	async function announce(text: string) {
		live = '';
		await tick();
		live = text;
	}

	/**
	 * Takes `candidates` as keywords; `rest` stays in the field. Refused ones go back into the field
	 * in front of the rest, with the reason of the first as field error. The field changes only
	 * after a successful save (a failed one leaves it as it was), and what was typed during the
	 * save stays behind the rest, so no character is lost. After a failed save the field shows
	 * `unsaved` (a pasted list that is not in the field yet).
	 */
	async function commit(
		candidates: string[],
		rest: string,
		original: string,
		unsaved: string = original
	) {
		if (candidates.length === 0) {
			input = rest;
			return;
		}
		const { accepted, refused } = planKeywordAdditions(keywords, candidates);
		const back = [...refused.map((entry) => entry.keyword), ...(rest.trim() === '' ? [] : [rest])];
		const remaining = back.length === 0 ? rest : back.join(', ');
		inputError = refused[0]?.error ?? null;
		if (accepted.length === 0) {
			input = remaining;
			field?.focus();
			return;
		}
		const added =
			accepted.length === 1
				? `Stichwort „${accepted[0]}“ hinzugefügt.`
				: `${accepted.length} Stichwörter hinzugefügt.`;
		if (!(await save([...keywords, ...accepted], added))) {
			if (input === original) input = unsaved;
			return;
		}
		if (input.startsWith(original)) input = remaining + input.slice(original.length);
		const taken =
			accepted.length === 1
				? `„${accepted[0]}“ übernommen.`
				: `${accepted.length} Stichwörter übernommen.`;
		await announce(refused.length === 0 ? taken : `${taken} ${refused.length} nicht übernommen.`);
	}

	/** Enter or "Hinzufügen": the whole field, split at commas. */
	function add() {
		const original = input;
		if (original.trim() === '') {
			inputError = 'Bitte ein Stichwort eingeben.';
			field?.focus();
			return;
		}
		void commit(splitListInput(original, true).parts, '', original);
	}

	/** A typed comma: the text before the caret becomes keywords, the text after it stays. */
	function commitAtCaret(target: HTMLInputElement) {
		const original = input;
		const { before, after } = splitAtCaret(original, target.selectionStart, target.selectionEnd);
		void commit(splitListInput(before, true).parts, after, original);
	}

	/** Backspace in the empty field: the last keyword comes back as editable text. */
	async function takeBackLast() {
		const last = keywords.at(-1);
		if (last === undefined) return;
		inputError = null;
		input = last;
		await tick();
		field?.setSelectionRange(last.length, last.length);
		if (await save(keywords.slice(0, -1), `Stichwort „${last}“ zum Bearbeiten ins Feld geholt.`)) {
			await announce(`„${last}“ zum Bearbeiten im Feld.`);
		} else if (input === last) {
			input = '';
		}
	}

	function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		// Enter also with Ctrl: the editor stands in no form of its own.
		const action =
			event.key === 'Enter' ? 'finish' : listInputAction(event, input, keywords.length > 0);
		if (action === null) return;
		event.preventDefault();
		if (saving) return;
		if (action === 'finish') add();
		else if (action === 'separate') commitAtCaret(event.currentTarget);
		else if (action === 'take-back') void takeBackLast();
	}

	/** A pasted list with commas or line breaks becomes keywords at once, its last part too. */
	function onpaste(event: ClipboardEvent & { currentTarget: HTMLInputElement }) {
		const text = event.clipboardData?.getData('text') ?? '';
		if (!hasListSeparator(text)) return;
		event.preventDefault();
		if (saving) return;
		const original = input;
		const target = event.currentTarget;
		const { before, after } = splitAtCaret(original, target.selectionStart, target.selectionEnd);
		const combined = before + text + after;
		void commit(splitListInput(combined, true).parts, '', original, combined);
	}

	/** A separator that came another way (autocorrect, drag and drop): like a typed comma. */
	function oninput() {
		if (saving || !hasListSeparator(input)) return;
		const original = input;
		const { parts, rest } = splitListInput(original, false);
		void commit(parts, rest, original);
	}
</script>

<fieldset class="keywords" aria-labelledby={ids.legend} aria-busy={saving ? 'true' : undefined}>
	<legend id={ids.legend}>Stichwörter</legend>
	<p class="hint" id={ids.hint}>
		{description} Groß-/Kleinschreibung egal, Umlaute auch. Gesucht wird am Wortanfang, auch in Adressen:
		„beispiel-shop“ findet „info@beispiel-shop.de“. Mehrere Wörter sind erlaubt.
	</p>
	{#if keywords.length === 0}
		<SectionMessage tone="warning" compact>{emptyText}</SectionMessage>
	{:else}
		<ul class="list" aria-label={`Stichwörter von „${name}“`}>
			{#each keywords as keyword (keyword)}
				<li>
					<span>{keyword}</span>
					<button
						type="button"
						class="remove"
						aria-label={`Stichwort „${keyword}“ entfernen`}
						aria-disabled={saving ? 'true' : undefined}
						onclick={() => {
							if (!saving) void remove(keyword);
						}}
					>
						<span aria-hidden="true">×</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="add">
		<label for={ids.input}>Neues Stichwort</label>
		<div class="row">
			<input
				bind:this={field}
				id={ids.input}
				type="text"
				maxlength={KEYWORD_MAX_LENGTH}
				autocomplete="off"
				aria-invalid={inputError !== null ? 'true' : undefined}
				aria-describedby={inputError !== null
					? `${ids.inputError} ${ids.keys} ${ids.hint}`
					: `${ids.keys} ${ids.hint}`}
				bind:value={input}
				{onkeydown}
				{onpaste}
				{oninput}
			/>
			<button
				type="button"
				class="button-secondary"
				aria-disabled={saving ? 'true' : undefined}
				onclick={() => {
					if (!saving) add();
				}}
			>
				Hinzufügen
			</button>
			<button
				type="button"
				class="button-secondary"
				aria-disabled={saving || !suggestionsMissing ? 'true' : undefined}
				title={`Vorschläge: ${KEYWORD_SUGGESTIONS.join(', ')}`}
				onclick={() => {
					if (!saving && suggestionsMissing) void suggest();
				}}
			>
				Vorschläge übernehmen
			</button>
		</div>
		<p class="hint" id={ids.keys}>
			Komma oder Enter übernimmt das Stichwort, auch aus einer eingefügten Liste. Die Rücktaste im
			leeren Feld holt das letzte Stichwort zum Bearbeiten zurück.
		</p>
		{#if inputError !== null}
			<p id={ids.inputError} class="field-error"><ErrorIcon /><span>{inputError}</span></p>
		{/if}
		<p class="visually-hidden" aria-live="polite">{live}</p>
	</div>
	{#if saveError !== null}
		<p class="alert-error" role="alert"><ErrorIcon /><span>{saveError}</span></p>
	{/if}
</fieldset>

<style>
	.keywords {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	legend {
		padding: 0 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-pill);
	}

	.remove {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		color: inherit;
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	.add {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	input {
		flex: 1 1 12rem;
		padding: 0.375rem 0.5rem;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* Locked while a change of the keywords is saved (ADR-0026, addendum of 2026-09-30). */
	.keywords[aria-busy='true'] [aria-disabled='true'] {
		cursor: progress;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
