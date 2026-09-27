<script lang="ts">
	import {
		ACCENT_DESCRIPTIONS,
		ACCENT_LABELS,
		ACCENT_THEMES,
		getAccentStore
	} from '$lib/accent.svelte';
	import ThemeIcon from '$lib/components/ThemeIcon.svelte';
	import {
		getThemeStore,
		THEME_LABELS,
		THEME_PREFERENCES,
		type ThemePreference
	} from '$lib/theme.svelte';

	// Settings "Darstellung" (ADR-0026 section 1, plan EH-8; ADR-0027 section 6): the mode as a group
	// of three radios and the accent color as a group of five radios, both shown as tiles, on the same
	// stores, lists and labels as the menu in the header (ADR-0025 section 10). Both show the same
	// choice in both directions, because they share the stores; the stores also follow other tabs.
	// A choice applies at once and stays on this device.
	const store = getThemeStore();
	const accentStore = getAccentStore();
	const uid = $props.id();

	const DESCRIPTIONS: Record<ThemePreference, string> = {
		light: 'Helle Flächen, dunkle Schrift.',
		dark: 'Dunkle Flächen, helle Schrift; schont die Augen am Abend.',
		system: 'Folgt der Einstellung von Windows und wechselt mit ihr.'
	};

	$effect(() => store.connect());
	$effect(() => accentStore.connect());
</script>

<svelte:head>
	<title>Darstellung · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<p class="intro">
	Die Wahl gilt sofort und nur in diesem Browser auf diesem Gerät. Dasselbe geht über das Symbol
	„Darstellung“ oben rechts.
</p>

<fieldset class="themes" aria-describedby={`${uid}-note`}>
	<legend>Farbschema</legend>
	<div class="tiles">
		{#each THEME_PREFERENCES as preference (preference)}
			<label class="tile">
				<input
					type="radio"
					name={`${uid}-theme`}
					value={preference}
					checked={store.preference === preference}
					aria-labelledby={`${uid}-${preference}-label`}
					aria-describedby={`${uid}-${preference}`}
					onchange={() => store.choose(preference)}
				/>
				<span class="preview" aria-hidden="true"><ThemeIcon {preference} size={28} /></span>
				<span class="label" id={`${uid}-${preference}-label`}>{THEME_LABELS[preference]}</span>
				<span class="description" id={`${uid}-${preference}`}>{DESCRIPTIONS[preference]}</span>
			</label>
		{/each}
	</div>
	<p class="note" id={`${uid}-note`}>
		Weitere Einstellungen der Darstellung (Dichte, Spalten) kommen später.
	</p>
</fieldset>

<fieldset class="themes" aria-describedby={`${uid}-accent-note`}>
	<legend>Farbe</legend>
	<div class="tiles">
		{#each ACCENT_THEMES as accent (accent)}
			<label class="tile">
				<input
					type="radio"
					name={`${uid}-accent`}
					value={accent}
					checked={accentStore.accent === accent}
					aria-labelledby={`${uid}-accent-${accent}-label`}
					aria-describedby={`${uid}-accent-${accent}`}
					onchange={() => accentStore.choose(accent)}
				/>
				<span class="preview swatch" style:--swatch={`var(--swatch-${accent})`} aria-hidden="true"
				></span>
				<span class="label" id={`${uid}-accent-${accent}-label`}>{ACCENT_LABELS[accent]}</span>
				<span class="description" id={`${uid}-accent-${accent}`}>
					{ACCENT_DESCRIPTIONS[accent]}
				</span>
			</label>
		{/each}
	</div>
	<p class="note" id={`${uid}-accent-note`}>
		Die Farbe gilt für Knöpfe, Links, Auswahl und Fokus, hell wie dunkel. Fehler bleiben rot und
		tragen immer ein Symbol und einen Text.
	</p>
</fieldset>

<style>
	.intro,
	.note {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.themes {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 0;
		border: none;
	}

	.themes + .themes {
		margin-top: 1.5rem;
	}

	legend {
		margin-bottom: 0.75rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.75rem;
	}

	.tile {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.75rem;
		align-items: center;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
		cursor: pointer;
	}

	/*
	 * The radio stays visible (the chosen state never depends on colour alone); its look comes from
	 * base.css, here only its place in the tile.
	 */
	.tile input {
		grid-row: 1;
		grid-column: 1;
	}

	.preview {
		display: inline-flex;
		grid-row: 1;
		grid-column: 2;
		justify-self: end;
		color: var(--color-text-muted);
	}

	/* The accent of the theme in the current mode, from tokens.css; a line keeps it apart. */
	.swatch {
		width: 1.75rem;
		height: 1.75rem;
		background: var(--swatch);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.label {
		grid-row: 2;
		grid-column: 1 / -1;
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.description {
		grid-row: 3;
		grid-column: 1 / -1;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.tile:has(input:checked) {
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.tile:has(input:checked) .label {
		font-weight: 600;
		color: var(--color-brand-soft-text);
	}

	.tile:has(input:checked) .preview {
		color: var(--color-brand-soft-text);
	}

	.tile:has(input:focus-visible) {
		outline: 2px solid var(--color-brand);
		outline-offset: 2px;
	}
</style>
