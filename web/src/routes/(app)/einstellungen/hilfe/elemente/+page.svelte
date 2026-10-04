<script lang="ts">
	import { resolve } from '$app/paths';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import Field from '$lib/components/form/Field.svelte';

	// Overview of the form controls (UI-1, ADR-0060), linked quietly from the help: every field,
	// select, text area, checkbox, radio, switch and button of the app in its states, on one page,
	// so their look can be checked in light and dark mode and in every accent. Every control works,
	// but nothing is saved or sent. The look comes only from base.css and Field; this page lays the
	// samples out and gives the controls no style of its own.
	const uid = $props.id();

	let text = $state('');
	let invalid = $state('Haus');
	let number = $state(3);
	let choice = $state('mittel');
	let note = $state('');
	let checked = $state(true);
	let some = $state(false);
	let partly = $state(true);
	let radio = $state('30');
	let switchOn = $state(true);
	let switchOff = $state(false);
	let search = $state('');
</script>

<svelte:head>
	<title>Eingabeelemente · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<div class="elements">
	<p class="intro">
		Alle Eingabe- und Auswahlelemente der App in ihren Zuständen, zum Prüfen der Darstellung in
		hellem und dunklem Modus und in jeder Farbe (<a href={resolve('/einstellungen/darstellung')}
			>Darstellung</a
		>). Mit der Maus zeigst du den Zustand „Zeigen“, mit der Tabulatortaste den Fokus. Die Felder
		lassen sich bedienen, gespeichert wird nichts.
	</p>

	<section aria-labelledby={`${uid}-text`}>
		<h3 id={`${uid}-text`}>Textfelder</h3>
		<div class="samples">
			<Field label="Normal" hint="Mit Platzhalter, solange das Feld leer ist.">
				{#snippet control(field)}
					<input {...field} type="text" placeholder="Etwa „Garten“" bind:value={text} />
				{/snippet}
			</Field>
			<Field label="Ungültig" error="Diesen Namen gibt es schon." hint="Fehler stehen am Feld.">
				{#snippet control(field)}
					<input {...field} type="text" bind:value={invalid} />
				{/snippet}
			</Field>
			<Field label="Gesperrt" hint="Gesperrt ist nicht beschäftigt.">
				{#snippet control(field)}
					<input {...field} type="text" value="Nicht änderbar" disabled />
				{/snippet}
			</Field>
			<Field label="Nur lesen" hint="Lesbar, aber nicht änderbar, etwa ein fester Projekt-Code.">
				{#snippet control(field)}
					<input {...field} class="input-mono" type="text" value="HAUS" readonly />
				{/snippet}
			</Field>
			<Field label="Passwort">
				{#snippet control(field)}
					<input {...field} type="password" autocomplete="off" value="geheim123" />
				{/snippet}
			</Field>
			<Field label="E-Mail-Adresse">
				{#snippet control(field)}
					<input {...field} type="email" autocomplete="off" placeholder="anna@example.com" />
				{/snippet}
			</Field>
			<Field label="Adresse (URL)">
				{#snippet control(field)}
					<input {...field} type="url" placeholder="https://example.com" />
				{/snippet}
			</Field>
			<Field label="Zahl" width="auto">
				{#snippet control(field)}
					<input {...field} type="number" min="1" max="10" bind:value={number} />
				{/snippet}
			</Field>
			<Field label="Datum" width="auto">
				{#snippet control(field)}
					<input {...field} type="date" />
				{/snippet}
			</Field>
			<Field label="Uhrzeit" width="auto">
				{#snippet control(field)}
					<input {...field} type="time" />
				{/snippet}
			</Field>
			<Field label="Code oder Pfad" hint="Codes, Schlüssel und Pfade in der Schrift für Code.">
				{#snippet control(field)}
					<input {...field} class="input-mono" type="text" placeholder="ABCD-EFGH" />
				{/snippet}
			</Field>
			<div class="sample">
				<p class="name" id={`${uid}-search`}>Suche</p>
				<div class="search-field">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.5" />
						<path d="M10.5 10.5L14 14" />
					</svg>
					<input
						type="search"
						aria-labelledby={`${uid}-search`}
						placeholder="Titel oder Beschreibung"
						bind:value={search}
					/>
				</div>
			</div>
		</div>
	</section>

	<section aria-labelledby={`${uid}-select`}>
		<h3 id={`${uid}-select`}>Auswahllisten und Textbereiche</h3>
		<div class="samples">
			<Field label="Auswahlliste" width="auto">
				{#snippet control(field)}
					<select {...field} bind:value={choice}>
						<option value="niedrig">Niedrig</option>
						<option value="mittel">Mittel</option>
						<option value="hoch">Hoch</option>
					</select>
				{/snippet}
			</Field>
			<Field label="Auswahlliste, ungültig" error="Bitte ein Projekt wählen." width="auto">
				{#snippet control(field)}
					<select {...field}>
						<option value="">Kein Projekt</option>
						<option value="haus">Haus › Garten (GART)</option>
					</select>
				{/snippet}
			</Field>
			<Field label="Auswahlliste, gesperrt" width="auto">
				{#snippet control(field)}
					<select {...field} disabled>
						<option>Haus</option>
					</select>
				{/snippet}
			</Field>
			<Field label="Textbereich" hint="Wächst nach unten, wenn du ihn ziehst.">
				{#snippet control(field)}
					<textarea {...field} rows="3" placeholder="Notiz" bind:value={note}></textarea>
				{/snippet}
			</Field>
			<Field label="Textbereich, nur lesen">
				{#snippet control(field)}
					<textarea {...field} rows="3" readonly
						>Dieser Text lässt sich markieren und kopieren.</textarea
					>
				{/snippet}
			</Field>
			<Field label="Textbereich, gesperrt">
				{#snippet control(field)}
					<textarea {...field} rows="3" disabled>Gesperrt.</textarea>
				{/snippet}
			</Field>
		</div>
	</section>

	<section aria-labelledby={`${uid}-choices`}>
		<h3 id={`${uid}-choices`}>Kästchen, Optionsfelder und Schalter</h3>
		<div class="samples">
			<fieldset class="sample">
				<legend class="name">Kästchen</legend>
				<label class="choice"><input type="checkbox" bind:checked={some} /> Nicht gewählt</label>
				<label class="choice"><input type="checkbox" bind:checked /> Gewählt</label>
				<label class="choice">
					<input type="checkbox" bind:indeterminate={partly} /> Teilweise gewählt
				</label>
				<label class="choice"><input type="checkbox" disabled /> Gesperrt</label>
				<label class="choice"><input type="checkbox" checked disabled /> Gewählt und gesperrt</label
				>
			</fieldset>
			<fieldset class="sample">
				<legend class="name">Optionsfelder</legend>
				<label class="choice">
					<input type="radio" name={`${uid}-radio`} value="7" bind:group={radio} /> 7 Tage
				</label>
				<label class="choice">
					<input type="radio" name={`${uid}-radio`} value="30" bind:group={radio} /> 30 Tage
				</label>
				<label class="choice">
					<input type="radio" name={`${uid}-radio`} value="90" bind:group={radio} /> 90 Tage
				</label>
				<label class="choice">
					<input type="radio" name={`${uid}-radio`} value="nie" disabled /> Gesperrt
				</label>
			</fieldset>
			<fieldset class="sample">
				<legend class="name">Schalter</legend>
				<label class="setting">
					<span>Eingeschaltet</span>
					<input type="checkbox" role="switch" bind:checked={switchOn} />
				</label>
				<label class="setting">
					<span>Ausgeschaltet</span>
					<input type="checkbox" role="switch" bind:checked={switchOff} />
				</label>
				<label class="setting">
					<span>Gesperrt</span>
					<input type="checkbox" role="switch" disabled />
				</label>
			</fieldset>
		</div>
	</section>

	<section aria-labelledby={`${uid}-buttons`}>
		<h3 id={`${uid}-buttons`}>Knöpfe</h3>
		<p class="note">
			Knöpfe zum Löschen sind bewusst nicht rot; Rot steht nur für echte Fehler (ADR-0009).
		</p>
		<div class="buttons">
			<button class="button-primary" type="button">Primär</button>
			<button class="button-secondary" type="button">Sekundär</button>
			<button class="button-subtle" type="button">Dezent</button>
			<button class="button-icon" type="button" aria-label="Symbolknopf" title="Symbolknopf">
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
		<div class="buttons">
			<button class="button-primary button-small" type="button">Primär klein</button>
			<button class="button-secondary button-small" type="button">Sekundär klein</button>
			<button class="button-subtle button-small" type="button">Dezent klein</button>
		</div>
		<div class="buttons">
			<button class="button-primary" type="button" aria-disabled="true">Gesperrt</button>
			<button class="button-secondary" type="button" aria-disabled="true">Gesperrt</button>
			<button class="button-secondary" type="button" aria-busy="true" aria-disabled="true">
				Läuft …
			</button>
		</div>
		<p class="alert-error">
			<ErrorIcon /><span>Fehler des Formulars: Der Server antwortet nicht.</span>
		</p>
	</section>
</div>

<style>
	.elements {
		display: grid;
		gap: 1.75rem;
	}

	section {
		display: grid;
		gap: 0.75rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.intro,
	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.intro a {
		color: var(--color-brand-text);
	}

	.samples {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: 1.25rem 1.5rem;
		align-items: start;
	}

	.sample {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	/* The name of a sample without a Field, like the label of a Field. */
	.name {
		padding: 0;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	/* Name left, switch right (ADR-0029, G-5). */
	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-body);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.button-icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
</style>
