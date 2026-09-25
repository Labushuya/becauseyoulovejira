<script lang="ts">
	import {
		IMPORT_KINDS,
		IMPORT_KIND_LABELS,
		IMPORT_SEARCH_TEXT,
		type ImportKind
	} from '$lib/domain/keywords';
	import {
		IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE,
		type ImportKeywordsStore
	} from '$lib/stores/import-keywords.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import KeywordEditor from './KeywordEditor.svelte';

	// Keywords of the file imports (E4 plan, package 21; ADR-0020): one list per kind of file. They
	// choose entries of the selection views at first; everything else can still be chosen by hand.
	let { store }: { store: ImportKeywordsStore } = $props();

	const uid = $props.id();
	const ids = { heading: `${uid}-heading`, body: `${uid}-body` };

	let bodyError = $state<string | null>(null);

	function emptyText(kind: ImportKind): string {
		return `Keine Stichwörter: In der Auswahl für ${IMPORT_KIND_LABELS[kind]} ist nichts vorausgewählt.`;
	}

	async function setMatchBody(matchBody: boolean) {
		bodyError = await store.save(
			'eml',
			{ keywords: store.settings.eml.keywords, matchBody },
			matchBody
				? 'Mail-Dateien: Auch der Textanfang wird durchsucht.'
				: 'Mail-Dateien: Nur der Betreff wird durchsucht.'
		);
	}
</script>

<section class="card" aria-labelledby={ids.heading}>
	<h3 id={ids.heading}>Stichwörter für Datei-Importe</h3>
	<p>
		Ziehst du Mail-Dateien, Kalenderdateien oder einen WhatsApp-Export in den Eingang, öffnet sich
		eine Auswahl. Einträge mit einem dieser Stichwörter sind dort schon ausgewählt; alle anderen
		kannst du dazuwählen.
	</p>
	<div class="visually-hidden" aria-live="polite">{store.announcement}</div>

	{#if store.state === 'loading'}
		<p class="hint" role="status">Stichwörter werden geladen …</p>
	{:else if store.state === 'unavailable'}
		<p class="hint" role="status">{IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE}</p>
	{:else if store.state === 'error'}
		<div class="alert-error" role="alert">
			<ErrorIcon /><span>{store.error}</span>
			<button class="secondary" type="button" onclick={() => void store.load()}>
				Erneut versuchen
			</button>
		</div>
	{:else if store.state === 'ready'}
		<ul class="kinds">
			{#each IMPORT_KINDS as kind (kind)}
				<li>
					<h4>{IMPORT_KIND_LABELS[kind]}</h4>
					<KeywordEditor
						keywords={store.settings[kind].keywords}
						name={IMPORT_KIND_LABELS[kind]}
						description={IMPORT_SEARCH_TEXT[kind]}
						emptyText={emptyText(kind)}
						onsave={(next, announcement) =>
							store.save(
								kind,
								{ keywords: next, matchBody: store.settings[kind].matchBody },
								`${IMPORT_KIND_LABELS[kind]}: ${announcement}`
							)}
					/>
					{#if kind === 'eml'}
						<label class="body">
							<input
								id={ids.body}
								type="checkbox"
								checked={store.settings.eml.matchBody}
								onchange={(event) => void setMatchBody(event.currentTarget.checked)}
							/>
							Auch die ersten 500 Zeichen des Textes durchsuchen
						</label>
						{#if bodyError !== null}
							<p class="alert-error" role="alert"><ErrorIcon /><span>{bodyError}</span></p>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.card {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	h4 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.kinds {
		display: grid;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.kinds li {
		display: grid;
		gap: 0.5rem;
	}

	.body {
		display: flex;
		gap: 0.375rem;
		align-items: baseline;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.secondary {
		padding: 0.375rem 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
