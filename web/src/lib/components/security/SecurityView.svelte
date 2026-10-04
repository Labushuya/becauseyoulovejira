<script lang="ts">
	import { resolve } from '$app/paths';
	import EmptyState from '$lib/components/guidance/EmptyState.svelte';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		LEVEL_CHOICES,
		LEVEL_LABELS,
		customSessionLabel,
		loginText,
		sessionLabel,
		statusLines,
		type LevelChoice
	} from '$lib/domain/security';
	import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
	import { helpHref } from '$lib/settings-sections';
	import type { SecurityLanStore } from '$lib/stores/security-lan.svelte';
	import type { SecurityStore } from '$lib/stores/security.svelte';
	import SecurityHosts from './SecurityHosts.svelte';
	import SecurityLan from './SecurityLan.svelte';

	// Page "Einstellungen → Sicherheit" (ADR-0055 §8): how the app protects itself against requests
	// from the browser, in one overview with a lozenge per point (red only for a real problem, never
	// here) and what each point means; the settings that make sense: the level of the protection
	// against guessing (two levels, no number), how long a sign-in stays valid (a short choice), the
	// further hosts (empty by default, after a restart); the access in the home network (plan
	// heimnetz, its own store `lan`, only for the own instance under Windows); the failed sign-ins of
	// the last 30 days and where the passwords are changed. Changes apply when chosen; a flag
	// confirms them.
	let { store, lan = null }: { store: SecurityStore; lan?: SecurityLanStore | null } = $props();

	const uid = $props.id();
	const overview = $derived(store.overview);
	const lines = $derived(overview === null ? [] : statusLines(overview));
	const busy = $derived(store.busy !== null);
	const levelMessage = $derived(
		store.partMessage !== null && store.partMessage.part !== 'hosts'
			? store.partMessage.message
			: null
	);

	function chooseLevel(level: LevelChoice) {
		if (overview !== null && overview.level !== level) void store.setLevel(level);
	}

	function chooseSession(event: Event & { currentTarget: HTMLSelectElement }) {
		if (overview === null) return;
		const current = overview.session.days === null ? 'custom' : String(overview.session.days);
		const days = Number(event.currentTarget.value);
		if (busy) {
			// One change at a time: the choice goes back to the saved one.
			event.currentTarget.value = current;
			return;
		}
		if (Number.isInteger(days) && days !== overview.session.days) void store.setSession(days);
	}
</script>

{#if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Sicherheit wird geladen …</p>
{:else if overview === null}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.load()}>
					Erneut laden
				</button>
			{/snippet}
		</SectionMessage>
	{/if}
{:else}
	<p class="intro">
		Wie sich becauseyoulovejira gegen Zugriffe aus dem Browser schützt: Jede Webseite, die du
		besuchst, kann Anfragen an diesen Rechner schicken. Mehr dazu in der
		<a href={helpHref('sicherheit')}>Hilfe unter „Sicherheit“</a>.
	</p>

	<section class="part" aria-labelledby={`${uid}-overview`}>
		<h3 id={`${uid}-overview`}>Überblick</h3>
		<ul class="lines">
			{#each lines as line (line.id)}
				<li class="line">
					<div class="head">
						<span class="title">{line.title}</span>
						<Lozenge label={line.state} tone={line.tone} icon={line.icon} />
					</div>
					<p class="text">{line.text}</p>
					<details class="meaning">
						<summary>
							Was bedeutet das?<span class="visually-hidden"> ({line.title})</span>
						</summary>
						<p>{line.meaning}</p>
					</details>
				</li>
			{/each}
		</ul>
		<p class="links">
			<a href={resolve('/einstellungen/kanaele')}>Schlüssel und Erweiterung unter „Kanäle“</a>
			· <a href={resolve('/einstellungen/sicherung')}>Sicherung</a>
		</p>
	</section>

	<section class="part" aria-labelledby={`${uid}-settings`}>
		<h3 id={`${uid}-settings`}>Einstellungen</h3>

		<fieldset
			class="choices"
			aria-describedby={`${uid}-level-note`}
			aria-busy={store.busy === 'level' ? 'true' : undefined}
		>
			<legend>Schutz vor Rateversuchen</legend>
			<p class="note" id={`${uid}-level-note`}>
				Gilt sofort. Zählt Anmeldungen und Anfragen ohne Anmeldung von diesem Rechner; was du
				angemeldet tust, zählt nie.
				{#if overview.level === 'custom'}
					In der Verwaltung sind eigene Regeln gesetzt; eine Wahl hier ersetzt sie.
				{:else if overview.level === 'off'}
					Der Schutz ist in der Verwaltung ausgeschaltet; eine Wahl hier schaltet ihn ein.
				{/if}
			</p>
			{#each LEVEL_CHOICES as level (level)}
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-level`}
						value={level}
						checked={overview.level === level}
						aria-disabled={busy ? 'true' : undefined}
						aria-labelledby={`${uid}-${level}-label`}
						aria-describedby={`${uid}-${level}-hint`}
						onclick={(event) => {
							if (busy) event.preventDefault();
						}}
						onchange={() => chooseLevel(level)}
					/>
					<span class="choice-text">
						<span class="label" id={`${uid}-${level}-label`}>{LEVEL_LABELS[level].label}</span>
						<span class="description" id={`${uid}-${level}-hint`}>{LEVEL_LABELS[level].hint}</span>
					</span>
				</label>
			{/each}
		</fieldset>

		<div class="field" aria-busy={store.busy === 'session' ? 'true' : undefined}>
			<label class="label" for={`${uid}-session`}>Gültigkeit der Anmeldung</label>
			<select
				id={`${uid}-session`}
				value={overview.session.days === null ? 'custom' : String(overview.session.days)}
				aria-describedby={`${uid}-session-hint`}
				aria-disabled={busy ? 'true' : undefined}
				onchange={chooseSession}
			>
				{#if overview.session.days === null}
					<option value="custom" disabled>{customSessionLabel(overview.session.seconds)}</option>
				{/if}
				{#each overview.session.choices as days (days)}
					<option value={String(days)}>{sessionLabel(days, overview.session.standard)}</option>
				{/each}
			</select>
			<p class="note" id={`${uid}-session-hint`}>
				So lange bleibt ein Gerät angemeldet, ohne dass die App geöffnet wird; eine offene App
				verlängert die Anmeldung selbst. Gilt für neue Anmeldungen und Verlängerungen.
			</p>
		</div>

		{#if levelMessage !== null}
			<SectionMessage tone="error" title={levelMessage.title} live>
				{levelMessage.text}
			</SectionMessage>
		{/if}

		<h4>Zusätzliche Adressen</h4>
		<SecurityHosts {store} {overview} />
	</section>

	<section class="part" id="heimnetz" aria-labelledby={`${uid}-lan`}>
		<h3 id={`${uid}-lan`}>Zugriff im Heimnetz</h3>
		<SecurityLan {overview} store={lan} />
	</section>

	<section class="part" id="anmeldungen" aria-labelledby={`${uid}-logins`}>
		<h3 id={`${uid}-logins`}>Fehlgeschlagene Anmeldungen</h3>
		{#if overview.logins === null}
			<SectionMessage tone="info" title={RESTART_NEEDED.title}>
				{restartNeeded('Das Protokoll fehlgeschlagener Anmeldungen ist')}
			</SectionMessage>
		{:else if overview.logins.groups.length === 0}
			<EmptyState
				size="compact"
				headingLevel={4}
				title="Keine fehlgeschlagenen Anmeldungen"
				description={`In den letzten ${overview.logins.days} Tagen ist keine Anmeldung gescheitert.`}
			/>
		{:else}
			<p class="note">
				{overview.logins.total === 1 ? '1 Versuch' : `${overview.logins.total} Versuche`} in den letzten
				{overview.logins.days} Tagen, davon {overview.logins.lastDay} in den letzten 24 Stunden.
			</p>
			<ul class="logins">
				{#each overview.logins.groups as group, index (index)}
					<li>{loginText(group)}</li>
				{/each}
			</ul>
		{/if}
		<p class="note">
			Gespeichert werden Zeit, eingegebenes Konto, Herkunft und Adresse, nie ein Passwort. Einträge
			verschwinden nach 30 Tagen.
		</p>
	</section>

	<section class="part" aria-labelledby={`${uid}-account`}>
		<h3 id={`${uid}-account`}>Passwörter</h3>
		<ul class="account">
			<li>
				Passwort des App-Kontos ändern: <a href={resolve('/einstellungen/konto')}
					>Einstellungen → Konto</a
				> nennt den Weg über die Verwaltung.
			</li>
			<li>
				Admin-Passwort vergessen: <code>admin-zuruecksetzen.bat</code> im Ordner app setzt es neu, ohne
				Daten zu löschen.
			</li>
		</ul>
	</section>
{/if}

<style>
	.intro,
	.note,
	.links {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.part {
		display: grid;
		gap: 0.625rem;
		margin-top: 1rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h4 {
		margin-top: 0.5rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.lines {
		display: grid;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--color-line);
	}

	.line {
		display: grid;
		gap: 0.25rem;
		padding: 0.625rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
	}

	.title {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.text,
	.meaning p {
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.meaning summary {
		width: fit-content;
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.meaning p {
		margin-top: 0.25rem;
		color: var(--color-text-muted);
	}

	.choices {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.choice {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
		cursor: pointer;
	}

	.choice-text {
		display: grid;
		gap: 0.125rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.description {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.field {
		display: grid;
		gap: 0.375rem;
		max-width: 40rem;
	}

	.field select {
		width: min(20rem, 100%);
	}

	.logins,
	.account {
		display: grid;
		gap: 0.375rem;
		padding-left: 1.25rem;
		font-size: var(--font-size-body);
		list-style: disc;
	}

	.logins li {
		overflow-wrap: anywhere;
	}
</style>
