<script lang="ts">
	import GuidanceIcon from '../guidance/GuidanceIcon.svelte';

	// Explanation at the top of "Kanäle" (ADR-0026 section 3, plan §3.4): the two ways into the inbox
	// side by side, with own texts after the pattern of the task board, and below, folded, how the
	// access data work (Windows user variables, ADR-0018). The folded part is the former card
	// "Zugangsdaten als Windows-Variable setzen"; it moves into the help with EH-9.
	const uid = $props.id();
</script>

<div class="intro">
	<!-- Two short explanations, not sections: the page has its own sections with these names below. -->
	<div class="ways">
		<div class="way">
			<span class="icon"><GuidanceIcon name="refresh" size={18} /></span>
			<p>
				<strong>Automatisch abrufen</strong>
				<span class="text">
					Google Calendar, Telegram und Postfächer liefern neue Einträge von selbst, solange die App
					läuft. Es kommt nur, was ein Stichwort trifft.
				</span>
			</p>
		</div>
		<div class="way">
			<span class="icon"><GuidanceIcon name="inbox" size={18} /></span>
			<p>
				<strong>Selbst hereinbringen</strong>
				<span class="text">
					Web-Links per Bookmarklet, Mail- und Kalenderdateien oder WhatsApp-Exporte per Drag &amp;
					Drop. Du wählst aus, was in den Eingang soll.
				</span>
			</p>
		</div>
	</div>

	<section class="variables" aria-labelledby={`${uid}-variables`}>
		<details>
			<summary id={`${uid}-variables`}>Zugangsdaten als Windows-Variable setzen</summary>
			<div class="details">
				<p>
					Jede Verbindung liest ihre Zugangsdaten aus einer Umgebungsvariablen deines
					Windows-Kontos, deren Name mit <code>BYL_</code> beginnt (nur Großbuchstaben, Ziffern und _).
					So landen sie weder in der App noch in Sicherungen oder Kopien des Ordners.
				</p>
				<ol>
					<li>
						<strong>Per Eingabeaufforderung:</strong> Windows-Taste, „cmd“ eingeben, Eingabetaste.
						Dann
						<code>setx NAME "Wert"</code> eingeben, also etwa
						<code>setx BYL_TELEGRAM_TOKEN "123456789:AA…"</code>. Den Wert in Anführungszeichen
						setzen. Die Meldung „Erfolgreich: Der angegebene Wert wurde gespeichert.“ bestätigt es.
					</li>
					<li>
						<strong>Oder per Systemsteuerung:</strong> Windows-Taste, „Umgebungsvariablen“ eingeben und
						„Umgebungsvariablen für dieses Konto bearbeiten“ öffnen. Unter „Benutzervariablen“ auf „Neu…“,
						Name und Wert eintragen, mit „OK“ bestätigen.
					</li>
					<li>
						Danach die App neu starten: <code>stop.bat</code> und dann <code>start.bat</code> im
						Ordner
						<code>app</code> doppelklicken. Erst dann sieht die App die Variable, und die Karte der Verbindung
						steht nicht mehr auf „Nicht eingerichtet“.
					</li>
				</ol>
				<p class="hint">
					Ändern geht genauso (<code>setx</code> mit neuem Wert, dann neu starten). Entfernen: in
					der Systemsteuerung die Variable löschen oder
					<code>reg delete HKCU\Environment /v NAME /f</code>, dann neu starten. Auf einem anderen
					Rechner musst du die Variablen neu anlegen.
				</p>
			</div>
		</details>
	</section>
</div>

<style>
	.intro {
		display: grid;
		gap: 0.75rem;
	}

	.ways {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.75rem;
	}

	.way {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.icon {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-control);
	}

	p {
		font-size: 0.875rem;
	}

	.way p {
		display: grid;
		gap: 0.25rem;
	}

	.way strong {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.way .text {
		color: var(--color-text-muted);
	}

	summary {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.details {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem 0 0 1rem;
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
		font-size: 0.875rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
