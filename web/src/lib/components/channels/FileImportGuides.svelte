<script lang="ts">
	import { resolve } from '$app/paths';
	import { PROTON_LINK, PROTON_STEPS } from '$lib/domain/channel-setup';
	import ExternalLink from '../guidance/ExternalLink.svelte';

	// Ways to files for the inbox (plan EH-7, page "Datei-Importe"): an explanation above the
	// keywords and, folded, where the files come from: mails from Proton and from Gmail as .eml
	// (Gmail with "Erweiterter Schutz" has no app password), calendar files and WhatsApp exports.
	// Each way ends in the inbox, where the file opens a selection with the keywords below chosen.
	const uid = $props.id();
</script>

<section class="ways" aria-labelledby={`${uid}-ways`}>
	<h3 id={`${uid}-ways`}>Woher die Dateien kommen</h3>
	<p class="intro">
		Du ziehst eine Datei in den <a href={resolve('/eingang')}>Eingang</a> oder wählst sie dort mit „Datei
		wählen“. Es öffnet sich eine Auswahl; was ein Stichwort unten trifft, ist schon markiert, alles andere
		wählst du dazu.
	</p>

	<details class="way">
		<summary>Mails aus Proton (.eml)</summary>
		<p><ExternalLink href={PROTON_LINK.href}>{PROTON_LINK.text}</ExternalLink></p>
		<ol>
			{#each PROTON_STEPS as step (step)}
				<li>{step}</li>
			{/each}
		</ol>
	</details>

	<details class="way">
		<summary>Mails aus Gmail (.eml)</summary>
		<p>
			Für Mails, die vor der Einrichtung kamen, oder wenn Google kein App-Passwort anbietet (etwa
			mit „Erweitertem Schutz“).
		</p>
		<ol>
			<li>Die Mail in Gmail im Browser öffnen.</li>
			<li>Oben rechts an der Mail auf „Mehr“ (⋮) klicken und „Nachricht herunterladen“ wählen.</li>
			<li>Die .eml-Datei in den Eingang ziehen.</li>
		</ol>
	</details>

	<details class="way">
		<summary>Kalenderdateien (.ics)</summary>
		<ol>
			<li>
				Eine Einladung als .ics-Datei speichern oder einen Kalender exportieren (Google Calendar:
				Einstellungen → „Importieren und exportieren“ → „Exportieren“, dann entpacken).
			</li>
			<li>Die .ics-Datei in den Eingang ziehen; jeder Termin wird ein eigener Vorschlag.</li>
		</ol>
	</details>

	<details class="way">
		<summary>WhatsApp-Chats</summary>
		<ol>
			<li>
				Den Chat in WhatsApp öffnen, „Mehr“ (⋮) → „Mehr“ → „Chat exportieren“ → „Ohne Medien“.
			</li>
			<li>Die Textdatei (.txt oder .zip) auf den Rechner bringen und in den Eingang ziehen.</li>
		</ol>
	</details>
</section>

<style>
	.ways {
		display: grid;
		gap: 0.75rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.intro,
	li,
	.way p {
		font-size: 0.875rem;
	}

	.way {
		padding: 0.625rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.way[open] > :global(:not(summary)) {
		margin-top: 0.75rem;
	}

	summary {
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	a {
		color: var(--color-brand-text);
	}
</style>
