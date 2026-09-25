<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		CONNECTION_TYPES,
		CONNECTION_TYPE_LABELS,
		connectionDraftErrors,
		emptyConnectionDraft,
		secretStatusText,
		type Connection,
		type ConnectionDraft,
		type ConnectionType
	} from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		CONNECTIONS_UNAVAILABLE_MESSAGE,
		type ConnectionsStore
	} from '$lib/stores/connections.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// Connections of the channels (E4 plan, package 10; ADR-0016 section 2, ADR-0018): list with the
	// state of the variables, switch, last run and cleaned error, a form for a new connection and
	// "Löschen" with a safety question. Access data are Windows user environment variables; the
	// app stores and shows only their names. `actions` adds buttons per connection (package 15:
	// "Jetzt abrufen").
	let {
		store,
		actions
	}: {
		store: ConnectionsStore;
		actions?: Snippet<[Connection]>;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		form: `${uid}-form`,
		type: `${uid}-type`,
		label: `${uid}-label`,
		secret: `${uid}-secret`,
		allowlist: `${uid}-allowlist`
	};

	let draft = $state<ConnectionDraft>(emptyConnectionDraft());
	let submitted = $state(false);
	let saving = $state(false);
	let serverFields = $state<Record<string, string>>({});
	let formMessage = $state<string | null>(null);
	let pendingDelete = $state<Connection | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let rowMessage = $state<{ id: string; text: string } | null>(null);

	const clientErrors = $derived(submitted ? connectionDraftErrors(draft) : {});
	const errors = $derived({
		label: clientErrors.label ?? serverFields.label,
		secretEnv: clientErrors.secretEnv ?? serverFields.secret_env,
		allowlistEnv: clientErrors.allowlistEnv ?? serverFields.settings
	});

	function chooseType(type: ConnectionType) {
		draft = emptyConnectionDraft(type);
		serverFields = {};
		submitted = false;
	}

	async function create(event: Event) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		formMessage = null;
		serverFields = {};
		if (Object.keys(connectionDraftErrors(draft)).length > 0) return;
		saving = true;
		const result = await store.create(draft);
		saving = false;
		if (result.ok) {
			draft = emptyConnectionDraft(draft.type);
			submitted = false;
			return;
		}
		serverFields = { ...result.fields };
		formMessage = result.message;
	}

	async function toggle(connection: Connection, enabled: boolean) {
		rowMessage = null;
		const result = await store.setEnabled(connection.id, enabled);
		if (!result.ok && result.message !== null)
			rowMessage = { id: connection.id, text: result.message };
	}

	async function confirmDelete() {
		if (pendingDelete === null) return;
		deleting = true;
		deleteError = null;
		const result = await store.remove(pendingDelete.id);
		deleting = false;
		if (result.ok) pendingDelete = null;
		else deleteError = result.message ?? Object.values(result.fields)[0] ?? null;
	}

	function time(value: string | null): string {
		return value === null ? 'noch nie' : formatBerlinDateTime(value);
	}
</script>

<section class="card" aria-labelledby={ids.heading}>
	<h3 id={ids.heading}>Verbindungen</h3>
	<p>
		Google Calendar und Telegram holt die App selbst ab, solange sie läuft. Die Zugangsdaten
		(geheime Kalenderadresse, Bot-Token, erlaubte IDs) liegen nur als Windows-Umgebungsvariablen
		deines Benutzerkontos, nie in der App oder ihren Sicherungen. Hier steht nur der Name der
		Variablen.
	</p>

	<div class="visually-hidden" aria-live="polite">{store.announcement}</div>

	{#if store.state === 'loading'}
		<p class="hint" role="status">Verbindungen werden geladen …</p>
	{:else if store.state === 'error' && store.error === CONNECTIONS_UNAVAILABLE_MESSAGE}
		<p class="hint" role="status">{store.error}</p>
	{:else if store.state === 'error'}
		<div class="alert-error" role="alert">
			<ErrorIcon /><span>{store.error}</span>
			<button class="secondary" type="button" onclick={() => void store.load()}>
				Erneut versuchen
			</button>
		</div>
	{:else if store.state === 'ready'}
		{#if store.connections.length === 0}
			<p class="hint">Noch keine Verbindung.</p>
		{:else}
			<ul class="connections">
				{#each store.connections as connection (connection.id)}
					{@const secret = secretStatusText(connection, store.status(connection.id))}
					<li class="connection">
						<div class="head">
							<h4>{connection.label}</h4>
							<span class="type">{CONNECTION_TYPE_LABELS[connection.type]}</span>
							<label class="switch">
								<input
									type="checkbox"
									checked={connection.enabled}
									onchange={(event) => void toggle(connection, event.currentTarget.checked)}
								/>
								Eingeschaltet
							</label>
						</div>
						<dl>
							<dt>Variable</dt>
							<dd><code>{connection.secretEnv}</code></dd>
							{#if connection.type === 'telegram'}
								<dt>Erlaubte IDs</dt>
								<dd><code>{connection.allowlistEnv}</code></dd>
							{/if}
							<dt>Letzter Abruf</dt>
							<dd>{time(connection.lastRunAt)}</dd>
							<dt>Zuletzt erfolgreich</dt>
							<dd>{time(connection.lastOkAt)}</dd>
						</dl>
						{#if secret !== null}
							<p class={secret.ok ? 'hint' : 'notice'}>{secret.text}</p>
						{/if}
						{#if connection.lastError !== ''}
							<p class="alert-error">
								<ErrorIcon /><span>Letzter Fehler: {connection.lastError}</span>
							</p>
						{/if}
						{#if connection.lastHint !== ''}
							<p class="notice">{connection.lastHint}</p>
						{/if}
						{#if rowMessage !== null && rowMessage.id === connection.id}
							<p class="alert-error" role="alert"><ErrorIcon /><span>{rowMessage.text}</span></p>
						{/if}
						<div class="buttons">
							{@render actions?.(connection)}
							<button
								class="secondary"
								type="button"
								onclick={() => {
									deleteError = null;
									pendingDelete = connection;
								}}
							>
								Löschen
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form class="form" novalidate aria-labelledby={ids.form} onsubmit={create}>
			<h4 id={ids.form}>Neue Verbindung</h4>
			<div class="field">
				<label for={ids.type}>Art</label>
				<select
					id={ids.type}
					value={draft.type}
					onchange={(event) => chooseType(event.currentTarget.value as ConnectionType)}
				>
					{#each CONNECTION_TYPES as type (type)}
						<option value={type}>{CONNECTION_TYPE_LABELS[type]}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for={ids.label}>Bezeichnung (Pflichtfeld)</label>
				<input
					id={ids.label}
					type="text"
					maxlength="100"
					aria-required="true"
					aria-invalid={errors.label ? 'true' : undefined}
					aria-describedby={errors.label ? `${ids.label}-error` : undefined}
					bind:value={draft.label}
				/>
				{#if errors.label}
					<p id={`${ids.label}-error`} class="field-error">
						<ErrorIcon /><span>{errors.label}</span>
					</p>
				{/if}
			</div>
			<div class="field">
				<label for={ids.secret}>
					{draft.type === 'calendar'
						? 'Variable mit der geheimen iCal-Adresse (Pflichtfeld)'
						: 'Variable mit dem Bot-Token (Pflichtfeld)'}
				</label>
				<input
					id={ids.secret}
					type="text"
					maxlength="64"
					spellcheck="false"
					autocomplete="off"
					aria-required="true"
					aria-invalid={errors.secretEnv ? 'true' : undefined}
					aria-describedby={errors.secretEnv ? `${ids.secret}-error` : undefined}
					bind:value={draft.secretEnv}
				/>
				{#if errors.secretEnv}
					<p id={`${ids.secret}-error`} class="field-error">
						<ErrorIcon /><span>{errors.secretEnv}</span>
					</p>
				{/if}
			</div>
			{#if draft.type === 'telegram'}
				<div class="field">
					<label for={ids.allowlist}
						>Variable mit den erlaubten Chat- bzw. User-IDs (Pflichtfeld)</label
					>
					<input
						id={ids.allowlist}
						type="text"
						maxlength="64"
						spellcheck="false"
						autocomplete="off"
						aria-required="true"
						aria-invalid={errors.allowlistEnv ? 'true' : undefined}
						aria-describedby={errors.allowlistEnv ? `${ids.allowlist}-error` : undefined}
						bind:value={draft.allowlistEnv}
					/>
					{#if errors.allowlistEnv}
						<p id={`${ids.allowlist}-error`} class="field-error">
							<ErrorIcon /><span>{errors.allowlistEnv}</span>
						</p>
					{/if}
				</div>
			{/if}
			<p class="hint">
				Hier nur den Namen eintragen, nie den Wert. Den Wert setzt du in Windows, wie unten
				beschrieben.
			</p>
			{#if formMessage !== null}
				<p class="alert-error" role="alert"><ErrorIcon /><span>{formMessage}</span></p>
			{/if}
			<div class="buttons">
				<button class="button-primary" type="submit" aria-disabled={saving ? 'true' : undefined}>
					{saving ? 'Wird angelegt …' : 'Verbindung anlegen'}
				</button>
			</div>
		</form>
	{/if}
</section>

<ConfirmDialog
	open={pendingDelete !== null}
	title={`Verbindung „${pendingDelete?.label ?? ''}“ löschen?`}
	confirmLabel="Löschen"
	busy={deleting}
	error={deleteError}
	onconfirm={() => void confirmDelete()}
	oncancel={() => {
		if (!deleting) pendingDelete = null;
	}}
>
	<p>
		Die App ruft dann nichts mehr ab. Einträge, die schon im Eingang sind, bleiben. Die
		Windows-Variable löschst du selbst, falls du sie nicht mehr brauchst.
	</p>
</ConfirmDialog>

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

	.connections {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.connection {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: baseline;
	}

	.type {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		margin-left: auto;
		font-size: 0.875rem;
		cursor: pointer;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0;
		font-size: 0.875rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	.form {
		display: grid;
		gap: 0.625rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.switch {
		color: var(--color-text);
	}

	input[type='text'],
	select {
		padding: 0.375rem 0.5rem;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.secondary {
		padding: 0.375rem 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.notice {
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: 0.375rem;
	}
</style>
