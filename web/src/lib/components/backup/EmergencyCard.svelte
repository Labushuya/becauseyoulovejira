<script lang="ts">
	import {
		EMERGENCY_CONTENTS,
		EMERGENCY_LOSSES,
		EMERGENCY_MANUAL,
		EMERGENCY_STEPS,
		type BackupOverview
	} from '$lib/domain/backup';
	import { formatPointInTime } from '$lib/domain/system';

	// The Notfallkarte (ADR-0046 §8): what a new machine needs, printed and kept next to the backup
	// disk. Where the app and the backups lie, which access data the backups hold (names only), and
	// the steps. Never the passphrase or a value: a line to write down by hand where the passphrase is
	// kept, not the passphrase.
	let {
		overview,
		address,
		printedAt
	}: { overview: BackupOverview; address: string; printedAt: string } = $props();

	const newestSealed = $derived(overview.sealed[0] ?? null);
	const newestLocal = $derived(
		overview.local.find((file) => file.ours === true) ?? overview.local[0] ?? null
	);
	const credentials = $derived.by(() => {
		if (!overview.settings.credentials) return 'Nicht mitgesichert.';
		if (overview.variables.length === 0) return 'Keine.';
		return `${overview.variables.join(', ')} (nur die Namen; die Werte stehen verschlüsselt in den Sicherungen im Zielverzeichnis).`;
	});
</script>

<article class="card" aria-labelledby="notfallkarte-title">
	<h1 id="notfallkarte-title">Notfallkarte becauseyoulovejira</h1>
	<p class="hint">Stand {printedAt}. Ohne Passphrase und ohne Werte der Zugangsdaten.</p>

	<h2>Wo alles liegt</h2>
	<dl class="facts">
		<div class="fact">
			<dt>Ordner der App</dt>
			<dd><code>{overview.appDir === '' ? '–' : overview.appDir}</code></dd>
		</div>
		<div class="fact">
			<dt>Adresse</dt>
			<dd><code>{address}</code></dd>
		</div>
		<div class="fact">
			<dt>Zielverzeichnis</dt>
			<dd>
				{#if overview.settings.target === null}
					Keins eingestellt – die Sicherungen liegen nur auf diesem Rechner.
				{:else}
					<code>{overview.settings.target}</code>
				{/if}
			</dd>
		</div>
		<div class="fact">
			<dt>Neueste Sicherung dort</dt>
			<dd>
				{newestSealed === null
					? 'Keine'
					: `${newestSealed.name} (${formatPointInTime(newestSealed.at)})`}
			</dd>
		</div>
		<div class="fact">
			<dt>Neueste Sicherung im Ordner app</dt>
			<dd>
				{newestLocal === null
					? 'Keine'
					: `${newestLocal.name} (${formatPointInTime(newestLocal.at)})`}
			</dd>
		</div>
		<div class="fact">
			<dt>Zugangsdaten in den Sicherungen</dt>
			<dd>{credentials}</dd>
		</div>
		<div class="fact">
			<dt>Die Passphrase steht in</dt>
			<dd class="blank">(hier von Hand eintragen, wo – nie die Passphrase selbst)</dd>
		</div>
	</dl>

	<h2>Neuer Rechner, Schritt für Schritt</h2>
	<ol class="steps">
		{#each EMERGENCY_STEPS as step (step.title)}
			<li><strong>{step.title}:</strong> {step.text}</li>
		{/each}
	</ol>

	<h2>Ohne die App öffnen</h2>
	<p>
		Mit dem Programm age (age-encryption.org) und tar von Windows, in einer Eingabeaufforderung:
	</p>
	<pre><code>{EMERGENCY_MANUAL.join('\n')}</code></pre>
	<p>{EMERGENCY_CONTENTS}</p>

	<h2>Was verloren gehen kann</h2>
	<ul>
		{#each EMERGENCY_LOSSES as loss (loss)}
			<li>{loss}</li>
		{/each}
	</ul>
</article>

<style>
	.card {
		display: grid;
		gap: 0.625rem;
		max-width: 48rem;
		font-size: var(--font-size-body);
	}

	h1 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h2 {
		margin-top: 0.75rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.hint {
		color: var(--color-text-muted);
	}

	.facts {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.fact {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		flex: 0 0 14rem;
		color: var(--color-text-muted);
	}

	dd {
		flex: 1 1 16rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.blank {
		min-height: 2.5rem;
		color: var(--color-text-muted);
		border-bottom: 1px dashed var(--color-line);
	}

	.steps,
	ul {
		display: grid;
		gap: 0.375rem;
		padding-left: 1.25rem;
	}

	pre {
		padding: 0.5rem 0.75rem;
		overflow-x: auto;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}
</style>
