<script lang="ts">
	import {
		ACCENT_DESCRIPTIONS,
		ACCENT_LABELS,
		ACCENT_THEMES,
		getAccentStore
	} from '$lib/accent.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ThemeIcon from '$lib/components/ThemeIcon.svelte';
	import {
		getThemeStore,
		THEME_LABELS,
		THEME_PREFERENCES,
		type ThemePreference
	} from '$lib/theme.svelte';
	import { getNotifyStore } from '$lib/attention-notify.svelte';
	import { appContext } from '$lib/stores/context.svelte';
	import { getTransparencyStore } from '$lib/transparency.svelte';

	// Settings "Darstellung" (ADR-0026 section 1, plan EH-8; ADR-0027 section 6; ADR-0029 section 7):
	// the mode as a group of three radios and the accent color as a group of four radios, both shown
	// as tiles, on the same stores, lists and labels as the menu in the header (ADR-0025 section 10),
	// and the switch "Glas-Effekt" of the group "Transparenz". Menu and page show the same choice in
	// both directions, because they share the stores; the stores also follow other tabs. A choice
	// applies at once and stays on this device. When the system reduces transparency, the glass stays
	// off whatever the switch says, and the page tells so.
	const store = getThemeStore();
	const accentStore = getAccentStore();
	const transparencyStore = getTransparencyStore();
	// Group "Hinweise" (ADR-0035 section 5, SF-6): the Windows notification is an opt-in; the
	// browser asks for the permission only when the switch is turned on.
	const notifyStore = getNotifyStore();
	// start.bat is named only to the administrator on the machine of the app (KOB-1, ADR-0057).
	const scripts = $derived(appContext.capabilities.scripts);
	const uid = $props.id();

	async function toggleNotify(event: Event & { currentTarget: HTMLInputElement }) {
		const control = event.currentTarget;
		if (control.checked) {
			control.checked = await notifyStore.enable();
		} else {
			notifyStore.disable();
		}
	}

	const DESCRIPTIONS: Record<ThemePreference, string> = {
		light: 'Helle Flächen, dunkle Schrift.',
		dark: 'Dunkle Flächen, helle Schrift; schont die Augen am Abend.',
		system: 'Folgt der Einstellung von Windows und wechselt mit ihr.'
	};

	$effect(() => store.connect());
	$effect(() => accentStore.connect());
	$effect(() => transparencyStore.connect());
	$effect(() => notifyStore.connect());
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

<fieldset class="themes">
	<legend>Transparenz</legend>
	<label class="setting">
		<span class="setting-name">Glas-Effekt</span>
		<input
			type="checkbox"
			role="switch"
			checked={transparencyStore.transparency === 'on'}
			aria-describedby={`${uid}-transparency-note`}
			onchange={(event) => transparencyStore.choose(event.currentTarget.checked ? 'on' : 'off')}
		/>
	</label>
	<p class="note" id={`${uid}-transparency-note`}>
		Halbtransparente, weichgezeichnete Flächen in Kopfzeile, Menüs, Seitenpanel und Dialogen. Folgt
		immer der Systemeinstellung „Transparenz reduzieren“. Ruckelt die Oberfläche, etwa über
		Remote-Desktop, schalte den Glas-Effekt aus.
	</p>
	{#if transparencyStore.systemReduces}
		<SectionMessage tone="info" compact>
			Die Systemeinstellung reduziert die Transparenz bereits. Alles bleibt undurchsichtig, egal wie
			der Schalter steht.
		</SectionMessage>
	{/if}
</fieldset>

<fieldset class="themes">
	<legend>Hinweise</legend>
	<label class="setting">
		<span class="setting-name">Windows-Benachrichtigung</span>
		<input
			type="checkbox"
			role="switch"
			checked={notifyStore.active}
			disabled={!notifyStore.supported}
			aria-busy={notifyStore.busy}
			aria-describedby={`${uid}-notify-note`}
			onchange={toggleNotify}
		/>
	</label>
	<p class="note" id={`${uid}-notify-note`}>
		Öffnest du becauseyoulovejira erneut{scripts ? ' (start.bat oder die Datei)' : ''}, obwohl die
		App schon in einem Tab im Hintergrund offen ist, meldet sich dieser Tab zusätzlich mit einer
		Benachrichtigung von Windows. Ein Klick darauf holt den Tab nach vorn. Beim Einschalten fragt
		der Browser einmal nach der Erlaubnis. Gilt nur in diesem Browser auf diesem Gerät.
	</p>
	{#if !notifyStore.supported}
		<SectionMessage tone="info" compact>
			Dieser Browser kann keine Benachrichtigungen zeigen. Der Hinweis im Tab und der blinkende
			Titel bleiben.
		</SectionMessage>
	{:else if notifyStore.permission === 'denied'}
		<SectionMessage tone="info" compact>
			Benachrichtigungen sind für diese Seite im Browser blockiert. Erlaube sie in den
			Website-Einstellungen des Browsers (Symbol links in der Adresszeile) und schalte dann erneut
			ein.
		</SectionMessage>
	{/if}
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
		grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
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

	/* One setting as a row: name left, switch right, like the macOS settings. */
	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		max-width: 25rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
		cursor: pointer;
	}

	.setting-name {
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.tile:has(input:focus-visible) {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}
</style>
