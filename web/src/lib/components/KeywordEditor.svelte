<script lang="ts">
	import {
		KEYWORD_MAX_LENGTH,
		KEYWORD_SUGGESTIONS,
		keywordInputError,
		withSuggestions
	} from '$lib/domain/keywords';
	import ErrorIcon from './ErrorIcon.svelte';

	// List of keywords (ADR-0020; E4 plan package 20): add one by one, remove, take over the
	// suggestions. Every change is saved at once through `onsave`, which answers with an error text
	// or null. Without keywords a neutral warning says what that means (`emptyText`).
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
		hint: `${uid}-hint`
	};

	let input = $state('');
	let inputError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let field = $state<HTMLInputElement>();

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

	async function add() {
		const error = keywordInputError(keywords, input);
		inputError = error;
		if (error !== null) {
			field?.focus();
			return;
		}
		const keyword = input.trim();
		if (await save([...keywords, keyword], `Stichwort „${keyword}“ hinzugefügt.`)) input = '';
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
</script>

<fieldset class="keywords" aria-labelledby={ids.legend}>
	<legend id={ids.legend}>Stichwörter</legend>
	<p class="hint" id={ids.hint}>
		{description} Groß- und Kleinschreibung und Umlaute zählen nicht, gesucht wird am Wortanfang; mehrere
		Wörter sind erlaubt.
	</p>
	{#if keywords.length === 0}
		<p class="notice">{emptyText}</p>
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
				aria-describedby={inputError !== null ? `${ids.inputError} ${ids.hint}` : ids.hint}
				bind:value={input}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						if (!saving) void add();
					}
				}}
			/>
			<button
				type="button"
				class="button-secondary"
				aria-disabled={saving ? 'true' : undefined}
				onclick={() => {
					if (!saving) void add();
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
		{#if inputError !== null}
			<p id={ids.inputError} class="field-error"><ErrorIcon /><span>{inputError}</span></p>
		{/if}
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
		border-radius: 0.375rem;
	}

	legend {
		padding: 0 0.25rem;
		font-size: 0.8125rem;
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
		font-size: 0.8125rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: 999px;
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
		border-radius: 999px;
		cursor: pointer;
	}

	.add {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: 0.8125rem;
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
		border-radius: 0.375rem;
	}

	[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.notice {
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: 0.375rem;
	}
</style>
