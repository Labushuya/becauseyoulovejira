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
	import { OFFLINE_CONSENT_TEXTS } from '$lib/domain/offline-consent';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { findOutbox } from '$lib/offline/outbox.svelte';
	import { getOfflineConsentStore } from '$lib/offline-consent.svelte';
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
	// Group "Handy" (MO-1a, ADR-0073 and its addendum "Einschalten"): the choice "Handy-Ansicht:
	// Automatisch / Aus", "Automatisch" by default; the frame applies only below 40rem. Reachable in
	// the frame under "Mehr" and with "Aus" in the view of today (the gear, then "Darstellung"). The
	// (app) layout follows the width. Since "Einschalten" also the switch "Ohne Verbindung merken
	// (dieses Gerät)" (ADR-0074 addendum "Zustimmung je Gerät"), locked with its reason while the server
	// cannot keep changes; turned off while changes are kept, the page says they still go.
	const mobileLayout = getMobileLayoutStore();
	const MOBILE_CHOICES = [
		{
			value: 'auto',
			label: 'Automatisch',
			description: 'Auf schmalen Bildschirmen die Handy-Ansicht, sonst die gewohnte Ansicht.'
		},
		{ value: 'off', label: 'Aus', description: 'Überall die gewohnte Ansicht, auch am Handy.' }
	] as const;
	const offlineConsent = getOfflineConsentStore();
	/** The outbox of the (app) layout; null outside of it (a test of the page alone). */
	const outbox = findOutbox();
	const canKeep = $derived(outbox?.supported ?? false);
	const keptCount = $derived(outbox?.count ?? 0);
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
	$effect(() => offlineConsent.connect());
</script>

<svelte:head>
	<title>Darstellung · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<p class="intro">
	Die Wahl gilt sofort und nur in diesem Browser auf diesem Gerät.{#if !mobileLayout.active}
		Dasselbe geht über das Symbol „Darstellung“ oben rechts.{/if}
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
	<legend>Handy</legend>
	<fieldset class="choice" aria-describedby={`${uid}-mobile-note`}>
		<legend class="setting-name">Handy-Ansicht</legend>
		<div class="tiles">
			{#each MOBILE_CHOICES as choice (choice.value)}
				<label class="tile">
					<input
						type="radio"
						name={`${uid}-mobile`}
						value={choice.value}
						checked={mobileLayout.enabled === (choice.value === 'auto')}
						aria-labelledby={`${uid}-mobile-${choice.value}-label`}
						aria-describedby={`${uid}-mobile-${choice.value}`}
						onchange={() => mobileLayout.choose(choice.value === 'auto')}
					/>
					<span class="label" id={`${uid}-mobile-${choice.value}-label`}>{choice.label}</span>
					<span class="description" id={`${uid}-mobile-${choice.value}`}>
						{choice.description}
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
	<p class="note" id={`${uid}-mobile-note`}>
		Die Handy-Ansicht gilt auf schmalen Bildschirmen unter etwa 640 Pixel Breite, etwa einem Handy
		hochkant: oben eine Leiste mit dem Namen der Ansicht, unten eine Leiste mit Tagesplan, Aufgaben,
		Erfassen, Eingang und „Mehr“ für alles Weitere. Beim Öffnen der App steht dort zuerst der
		Tagesplan. Auf breiteren Bildschirmen bleibt alles, wie es ist. Gilt nur in diesem Browser auf
		diesem Gerät.
	</p>
	{#if mobileLayout.enabled && !mobileLayout.narrow}
		<SectionMessage tone="info" compact>
			Dieses Fenster ist zu breit für die Handy-Ansicht. Hier bleibt die gewohnte Ansicht; die
			Handy-Ansicht erscheint, sobald das Fenster schmaler als etwa 640 Pixel ist.
		</SectionMessage>
	{/if}
	<label class="setting">
		<span class="setting-name">{OFFLINE_CONSENT_TEXTS.setting}</span>
		<input
			type="checkbox"
			role="switch"
			checked={offlineConsent.consent === 'yes'}
			disabled={!canKeep}
			aria-describedby={`${uid}-offline-note`}
			onchange={(event) => offlineConsent.choose(event.currentTarget.checked ? 'yes' : 'no')}
		/>
	</label>
	<p class="note" id={`${uid}-offline-note`}>
		Reißt die Verbindung ab, merkt sich die App in der Handy-Ansicht einige Änderungen auf diesem
		Gerät und überträgt sie von selbst, sobald der Server wieder erreichbar ist; was gemerkt wird,
		sagt die Hilfe unter „Ohne Verbindung“. Aus: Die App merkt sich nichts, eine Änderung ohne
		Verbindung scheitert wie bisher mit einer Meldung. Gilt nur in diesem Browser auf diesem Gerät.
	</p>
	{#if !canKeep}
		<SectionMessage tone="info" compact>
			{restartNeeded('Das Merken ohne Verbindung ist')}
		</SectionMessage>
	{:else if offlineConsent.consent !== 'yes' && keptCount > 0}
		<SectionMessage tone="info" compact>
			{OFFLINE_CONSENT_TEXTS.stillSent(keptCount)}
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

	/* The choice "Handy-Ansicht" (package "Einschalten"): its name above its two tiles. */
	.choice {
		min-width: 0;
		padding: 0;
		border: none;
	}

	.choice legend {
		margin-bottom: 0.5rem;
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
