<script lang="ts">
	import {
		choiceNote,
		filterRepoChoices,
		repoKey,
		type GitHubRepoChoice
	} from '$lib/domain/github';
	import type { GitHubRepoListState } from '$lib/stores/github.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// The repositories the token may read, to choose from (ADR-0050, addendum of 2026-10-02; the
	// rule "aus Listen wählen" of ADR-0042): check boxes for several at once, own repositories first,
	// those entered already checked and locked, those of "Alle meine Repositorys" and excluded ones
	// named. Typing in the filter only narrows the list (same normalization as the TicketPicker), it
	// is never needed; Esc empties the filter first. Without a token GitHub names no list: then a
	// hint, and the owner keeps the field to type "Besitzer/Name". Used in the dialog "Repository
	// hinzufügen …" and inline in the assistant.
	let {
		list,
		chosen = $bindable([]),
		onrefresh
	}: {
		/** The list of the store, null before it was asked for. */
		list: GitHubRepoListState | null;
		/** The chosen repositories ("Besitzer/Name"). */
		chosen?: string[];
		/** "Liste neu laden": asks the server to read the list again. */
		onrefresh?: () => void;
	} = $props();

	/** More than this many repositories are found through the filter. */
	const SHOWN_MAX = 100;
	/** The filter shows from this many repositories on. */
	const FILTER_FROM = 9;

	const uid = $props.id();
	const ids = { list: `${uid}-list`, count: `${uid}-count`, legend: `${uid}-legend` };
	let query = $state('');

	const repos = $derived(list?.kind === 'ready' ? list.list.repos : []);
	const matches = $derived(filterRepoChoices(repos, query));
	const shown = $derived(matches.slice(0, SHOWN_MAX));
	const chosenKeys = $derived(new Set(chosen.map(repoKey)));
	const countText = $derived(
		[
			chosen.length === 0 ? '' : chosen.length === 1 ? '1 gewählt' : `${chosen.length} gewählt`,
			query.trim() === '' ? '' : `${matches.length} von ${repos.length}`
		]
			.filter((part) => part !== '')
			.join(' · ')
	);
	const message = $derived.by((): { tone: 'info' | 'error'; text: string } | null => {
		if (list === null || list.kind === 'loading') return null;
		if (list.kind === 'error') return { tone: list.restart ? 'info' : 'error', text: list.message };
		if (list.list.status === 'ok') {
			return list.list.repos.length === 0
				? { tone: 'info', text: 'Das Token nennt keine Repositorys.' }
				: null;
		}
		return { tone: list.list.status === 'error' ? 'error' : 'info', text: list.list.message };
	});

	function toggle(choice: GitHubRepoChoice, on: boolean) {
		chosen = on
			? [...chosen.filter((name) => repoKey(name) !== choice.key), choice.repo]
			: chosen.filter((name) => repoKey(name) !== choice.key);
	}

	function onfilterkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || query === '') return;
		event.preventDefault();
		event.stopPropagation();
		query = '';
	}
</script>

<fieldset class="picker" aria-describedby={countText === '' ? undefined : ids.count}>
	<legend id={ids.legend}>Aus deinen Repositorys wählen</legend>
	{#if list === null || list.kind === 'loading'}
		<p class="note" role="status">Repositorys werden geladen …</p>
	{/if}
	{#if message !== null}
		<SectionMessage tone={message.tone} compact>{message.text}</SectionMessage>
	{/if}
	{#if repos.length > 0}
		{#if repos.length >= FILTER_FROM}
			<span class="search-field">
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<circle cx="7" cy="7" r="4.25" />
					<path d="M10.25 10.25L13.5 13.5" />
				</svg>
				<input
					type="search"
					autocomplete="off"
					spellcheck="false"
					aria-label="Repositorys filtern"
					aria-controls={ids.list}
					placeholder="Filtern"
					bind:value={query}
					onkeydown={onfilterkeydown}
				/>
			</span>
		{/if}
		<p class="count" id={ids.count} aria-live="polite">{countText}</p>
		{#if matches.length === 0}
			<p class="note">Kein Repository passt zum Filter.</p>
		{/if}
		<ul class="choices" id={ids.list} aria-labelledby={ids.legend}>
			{#each shown as choice (choice.key)}
				{@const entered = choice.state === 'entered'}
				{@const note = choiceNote(choice)}
				<li>
					<label class="choice">
						<input
							type="checkbox"
							checked={entered || chosenKeys.has(choice.key)}
							aria-disabled={entered ? 'true' : undefined}
							onclick={(event) => {
								if (entered) event.preventDefault();
							}}
							onchange={(event) => toggle(choice, event.currentTarget.checked)}
						/>
						<span class="name">{choice.repo}</span>
						{#if note !== ''}
							<span class="info">{note}</span>
						{/if}
					</label>
				</li>
			{/each}
		</ul>
		{#if matches.length > shown.length}
			<p class="note">
				{matches.length - shown.length} weitere: bitte mit dem Filter eingrenzen.
			</p>
		{/if}
		{#if list?.kind === 'ready' && list.list.more}
			<p class="note">
				GitHub nennt mehr Repositorys, als die Liste zeigt; weitere trägst du als „Besitzer/Name“
				ein.
			</p>
		{/if}
	{/if}
	{#if onrefresh !== undefined && list !== null && list.kind !== 'loading' && !(list.kind === 'ready' && list.list.status === 'no_token')}
		<div>
			<button class="button-subtle" type="button" onclick={() => onrefresh()}>
				Liste neu laden
			</button>
		</div>
	{/if}
</fieldset>

<style>
	.picker {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		padding: 0;
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.search-field {
		width: min(16rem, 100%);
	}

	.search-field input[type='search'] {
		width: 100%;
	}

	.count,
	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.count:empty {
		display: none;
	}

	.choices {
		display: grid;
		gap: 0.125rem;
		max-height: 16rem;
		margin: 0;
		padding: 0.25rem 0;
		overflow-y: auto;
		list-style: none;
		border-block: 1px solid var(--color-line);
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		align-items: center;
		min-width: 0;
		padding: 0.25rem 0.25rem;
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.info {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
