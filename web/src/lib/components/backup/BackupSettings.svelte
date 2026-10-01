<script lang="ts">
	import { untrack } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		CREDENTIALS_TEXTS,
		KEEP,
		KEEP_LABELS,
		KEEP_NAMES,
		TARGET_MAX_LENGTH,
		TARGET_PROBLEM_TEXTS,
		freeText,
		keepProblem,
		type BackupOverview,
		type KeepName
	} from '$lib/domain/backup';
	import type { BackupStore } from '$lib/stores/backup.svelte';

	// Settings of the backups (ADR-0046): the target folder (checked by the control script: full
	// path, outside of app, existing, writable, space), the switch "Zugangsdaten mitsichern" (takes
	// effect at once, with the hint where the values come from) and the generations kept. A browser
	// cannot pick a folder and hand its path to a page, so the path is typed or pasted.
	let { store, overview }: { store: BackupStore; overview: BackupOverview } = $props();

	const uid = $props.id();
	const ids = {
		target: `${uid}-target`,
		targetHint: `${uid}-target-hint`,
		targetError: `${uid}-target-error`,
		credentialsHint: `${uid}-credentials-hint`,
		keepHint: `${uid}-keep-hint`,
		keepError: `${uid}-keep-error`
	};

	// The forms start with the saved values; what the user types stays until it is saved.
	let target = $state(untrack(() => overview.settings.target ?? ''));
	let keep = $state<Record<KeepName, number>>(
		untrack(() => ({
			daily: overview.settings.daily,
			weekly: overview.settings.weekly,
			monthly: overview.settings.monthly
		}))
	);
	let keepInvalid = $state(false);

	const busy = $derived(store.busy !== null);
	const targetError = $derived(
		store.targetProblem === null
			? ''
			: (TARGET_PROBLEM_TEXTS[store.targetProblem as keyof typeof TARGET_PROBLEM_TEXTS] ??
					TARGET_PROBLEM_TEXTS.format)
	);
	const keepError = $derived(keepInvalid || store.keepProblem ? TARGET_PROBLEM_TEXTS.keep : '');

	function saveTarget(event: SubmitEvent) {
		event.preventDefault();
		if (!busy) void store.saveTarget(target);
	}

	function saveKeep(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		keepInvalid = keepProblem(keep);
		if (!keepInvalid) void store.saveKeep({ ...keep });
	}

	function toggleCredentials(event: Event & { currentTarget: HTMLInputElement }) {
		void store.setCredentials(event.currentTarget.checked);
	}

	function guardSwitch(event: MouseEvent) {
		if (busy) event.preventDefault();
	}
</script>

<section class="part" aria-labelledby={`${uid}-target-title`}>
	<h3 id={`${uid}-target-title`}>Zielverzeichnis</h3>
	<!-- The checks speak inline at the field (ADR-0009), not as bubbles of the browser. -->
	<form class="form" novalidate aria-busy={store.busy === 'target'} onsubmit={saveTarget}>
		<label class="label" for={ids.target}>Ordner für die verschlüsselten Sicherungen</label>
		<input
			id={ids.target}
			type="text"
			spellcheck="false"
			autocomplete="off"
			maxlength={TARGET_MAX_LENGTH}
			bind:value={target}
			aria-invalid={targetError === '' ? undefined : 'true'}
			aria-describedby={targetError === ''
				? ids.targetHint
				: `${ids.targetError} ${ids.targetHint}`}
		/>
		{#if targetError !== ''}
			<p class="field-error" id={ids.targetError}><ErrorIcon /><span>{targetError}</span></p>
		{/if}
		<p class="hint" id={ids.targetHint}>
			Am besten ein anderes Laufwerk als das der App: eine USB-Platte, ein zweites Laufwerk, eine
			Freigabe deines NAS (\\NAS\Freigabe\Ordner) oder ein Ordner, den ein Cloud-Dienst
			synchronisiert. Pfad aus dem Explorer kopieren (Adresszeile) und hier einfügen; leer lassen,
			wenn nur im Ordner app gesichert werden soll.
		</p>
		<div>
			<button
				class="button-secondary"
				type="submit"
				aria-disabled={busy}
				aria-busy={store.busy === 'target'}
			>
				Zielverzeichnis speichern
			</button>
		</div>
	</form>
	{#if overview.target !== null}
		<dl class="rows">
			<div class="row">
				<dt>Eingestellt</dt>
				<dd>
					<code>{overview.target.path}</code>
					<span class="hint">
						{overview.target.reachable ? 'Erreichbar' : 'Gerade nicht erreichbar'}{overview.target
							.freeBytes === null
							? ''
							: ` · ${freeText(overview.target.freeBytes)}`}
					</span>
				</dd>
			</div>
		</dl>
		{#if overview.target.sameDrive}
			<SectionMessage tone="warning" compact>
				Das Zielverzeichnis liegt auf demselben Laufwerk wie die App. Das hilft gegen
				versehentliches Löschen, aber nicht gegen einen Plattendefekt.
			</SectionMessage>
		{/if}
	{/if}
</section>

<section class="part" aria-labelledby={`${uid}-credentials-title`}>
	<h3 id={`${uid}-credentials-title`}>Zugangsdaten</h3>
	<label class="setting">
		<span class="setting-name">{CREDENTIALS_TEXTS.label}</span>
		<input
			type="checkbox"
			role="switch"
			checked={overview.settings.credentials}
			aria-disabled={busy}
			aria-busy={store.busy === 'credentials'}
			aria-describedby={ids.credentialsHint}
			onclick={guardSwitch}
			onchange={toggleCredentials}
		/>
	</label>
	<p class="hint" id={ids.credentialsHint}>{CREDENTIALS_TEXTS.hint}</p>
	{#if overview.variables.length > 0}
		<p class="hint">
			Zurzeit {overview.variables.length === 1
				? 'eine Variable'
				: `${overview.variables.length} Variablen`}:
			{#each overview.variables as name, index (name)}<code>{name}</code>{index <
				overview.variables.length - 1
					? ', '
					: ''}{/each}
		</p>
	{:else}
		<p class="hint">Zurzeit gibt es in deinem Konto keine BYL_*-Variable.</p>
	{/if}
</section>

<section class="part" aria-labelledby={`${uid}-keep-title`}>
	<h3 id={`${uid}-keep-title`}>Aufbewahrung</h3>
	<p class="hint" id={ids.keepHint}>
		Von jedem Tag, jeder Woche und jedem Monat bleibt die neueste Sicherung; ältere löscht die App
		(im Ordner app und im Zielverzeichnis). Andere Sicherungen in pb_data\backups bleiben.
	</p>
	<form class="form" novalidate aria-busy={store.busy === 'keep'} onsubmit={saveKeep}>
		<div class="keep">
			{#each KEEP_NAMES as name (name)}
				<label class="keep-field">
					<span>{KEEP_LABELS[name]} ({KEEP[name].min}–{KEEP[name].max})</span>
					<input
						type="number"
						step="1"
						min={KEEP[name].min}
						max={KEEP[name].max}
						bind:value={keep[name]}
						aria-invalid={keepError === '' ? undefined : 'true'}
						aria-describedby={keepError === '' ? ids.keepHint : `${ids.keepError} ${ids.keepHint}`}
					/>
				</label>
			{/each}
		</div>
		{#if keepError !== ''}
			<p class="field-error" id={ids.keepError}><ErrorIcon /><span>{keepError}</span></p>
		{/if}
		<div>
			<button
				class="button-secondary"
				type="submit"
				aria-disabled={busy}
				aria-busy={store.busy === 'keep'}
			>
				Aufbewahrung speichern
			</button>
		</div>
	</form>
</section>

<style>
	.hint,
	.label,
	.keep-field span {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.label {
		color: var(--color-text);
		font-weight: 500;
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

	.form {
		display: grid;
		gap: 0.375rem;
		max-width: 40rem;
	}

	.rows {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		flex: 0 0 10rem;
		color: var(--color-text-muted);
	}

	dd {
		display: grid;
		flex: 1 1 16rem;
		gap: 0.125rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		width: min(28rem, 100%);
		cursor: pointer;
	}

	.setting-name {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.keep {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.keep-field {
		display: grid;
		gap: 0.25rem;
	}

	.keep-field input[type='number'] {
		width: min(6rem, 100%);
	}
</style>
