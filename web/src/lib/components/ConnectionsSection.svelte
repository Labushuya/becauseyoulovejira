<script lang="ts">
	import {
		CONNECTION_TYPES,
		CONNECTION_TYPE_LABELS,
		KEYWORD_SEARCH_TEXT,
		MAIL_PROVIDERS,
		MAIL_PROVIDER_LABELS,
		NO_KEYWORDS_WARNING,
		connectionDraftErrors,
		emptyConnectionDraft,
		secretStatusText,
		withMailProvider,
		type Connection,
		type ConnectionDraft,
		type ConnectionType,
		type MailProvider
	} from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		CONNECTIONS_UNAVAILABLE_MESSAGE,
		type ConnectionsStore
	} from '$lib/stores/connections.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import KeywordEditor from './KeywordEditor.svelte';
	import MailboxPicker from './MailboxPicker.svelte';

	// Connections of the channels (E4 plan, package 10; ADR-0016 section 2, ADR-0018): list with the
	// state of the variables, switch, last run and cleaned error, a form for a new connection and
	// "Löschen" with a safety question, "Jetzt abrufen" (package 15) and "Aktualisieren" for the
	// result of a run of the cron job. Access data are Windows user environment variables; the app
	// stores and shows only their names. Each connection has its keywords (package 20, ADR-0020) and,
	// for Telegram, the switch for the answer to messages without keyword. Mailboxes (package 22)
	// name provider and user; the mail helper byl-mail.exe fetches them, not the server, so they
	// have no "Jetzt abrufen" but a switch for searching the start of the text, and "Aus dem Postfach
	// wählen" for the mailbox selection (package 23).
	let {
		store
	}: {
		store: ConnectionsStore;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		form: `${uid}-form`,
		type: `${uid}-type`,
		label: `${uid}-label`,
		secret: `${uid}-secret`,
		allowlist: `${uid}-allowlist`,
		provider: `${uid}-provider`,
		user: `${uid}-user`
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
	let picking = $state<Connection | null>(null);

	const clientErrors = $derived(submitted ? connectionDraftErrors(draft) : {});
	const errors = $derived({
		label: clientErrors.label ?? serverFields.label,
		secretEnv: clientErrors.secretEnv ?? serverFields.secret_env,
		allowlistEnv:
			clientErrors.allowlistEnv ?? (draft.type === 'telegram' ? serverFields.settings : undefined),
		mailUser: clientErrors.mailUser ?? (draft.type === 'mail' ? serverFields.settings : undefined)
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

	async function saveKeywords(connection: Connection, keywords: string[], announcement: string) {
		const result = await store.saveSettings(
			connection.id,
			{ keywords, replyNoMatch: connection.replyNoMatch, matchBody: connection.matchBody },
			announcement
		);
		if (result.ok) return null;
		return (
			result.message ??
			Object.values(result.fields)[0] ??
			'Die Stichwörter ließen sich nicht speichern.'
		);
	}

	async function setReply(connection: Connection, replyNoMatch: boolean) {
		rowMessage = null;
		const result = await store.saveSettings(
			connection.id,
			{ keywords: connection.keywords, replyNoMatch, matchBody: connection.matchBody },
			replyNoMatch
				? `„${connection.label}“ antwortet auf Nachrichten ohne Stichwort.`
				: `„${connection.label}“ antwortet nicht mehr auf Nachrichten ohne Stichwort.`
		);
		if (!result.ok) showSettingsError(connection, result.message, result.fields);
	}

	async function setMatchBody(connection: Connection, matchBody: boolean) {
		rowMessage = null;
		const result = await store.saveSettings(
			connection.id,
			{ keywords: connection.keywords, replyNoMatch: connection.replyNoMatch, matchBody },
			matchBody
				? `„${connection.label}“ durchsucht auch den Anfang des Textes.`
				: `„${connection.label}“ durchsucht nur den Betreff.`
		);
		if (!result.ok) showSettingsError(connection, result.message, result.fields);
	}

	function showSettingsError(
		connection: Connection,
		message: string | null,
		fields: Record<string, string>
	) {
		rowMessage = {
			id: connection.id,
			text: message ?? Object.values(fields)[0] ?? 'Die Einstellung ließ sich nicht speichern.'
		};
	}

	async function runNow(connection: Connection) {
		rowMessage = null;
		const result = await store.runNow(connection.id);
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
		Google Calendar und Telegram holt die App selbst ab, solange sie läuft, Postfächer der
		Mail-Hilfsprozess <code>byl-mail.exe</code>. Die Zugangsdaten (geheime Kalenderadresse,
		Bot-Token, erlaubte IDs, Passwort des Postfachs) liegen nur als Windows-Umgebungsvariablen
		deines Benutzerkontos, nie in der App oder ihren Sicherungen. Hier steht nur der Name der
		Variablen.
	</p>
	<p>
		Automatisch kommt nur in den Eingang, was ein Stichwort der Verbindung trifft. Ohne Stichwörter
		übernimmt eine Verbindung nichts. Neue Stichwörter gelten für das, was danach ankommt.
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
			<p class="refresh">
				<button class="secondary" type="button" onclick={() => void store.load()}>
					Aktualisieren
				</button>
				<span class="hint">
					Solange die App läuft, ruft Google Calendar alle 15 Minuten ab, Telegram jede Minute und
					ein Postfach alle 5 Minuten; „Aktualisieren“ zeigt das Ergebnis.
				</span>
			</p>
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
							{#if connection.type === 'mail'}
								<dt>Anbieter</dt>
								<dd>
									{connection.mailProvider === ''
										? 'unbekannt'
										: MAIL_PROVIDER_LABELS[connection.mailProvider]}
								</dd>
								<dt>Benutzer</dt>
								<dd>{connection.mailUser}</dd>
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
						<KeywordEditor
							keywords={connection.keywords}
							name={connection.label}
							description={KEYWORD_SEARCH_TEXT[connection.type]}
							emptyText={NO_KEYWORDS_WARNING}
							onsave={(next, announcement) => saveKeywords(connection, next, announcement)}
						/>
						{#if connection.type === 'telegram'}
							<label class="reply">
								<input
									type="checkbox"
									checked={connection.replyNoMatch}
									onchange={(event) => void setReply(connection, event.currentTarget.checked)}
								/>
								Auf Nachrichten ohne Stichwort antworten („Kein Stichwort erkannt – nicht gespeichert“)
							</label>
						{/if}
						{#if connection.type === 'mail'}
							<label class="reply">
								<input
									type="checkbox"
									checked={connection.matchBody}
									onchange={(event) => void setMatchBody(connection, event.currentTarget.checked)}
								/>
								Auch die ersten 500 Zeichen des Textes durchsuchen
							</label>
						{/if}
						{#if rowMessage !== null && rowMessage.id === connection.id}
							<p class="alert-error" role="alert"><ErrorIcon /><span>{rowMessage.text}</span></p>
						{/if}
						{#if connection.type === 'mail'}
							<p class="hint">
								Der Mail-Hilfsprozess byl-mail.exe ruft dieses Postfach alle 5 Minuten ab, solange
								die App läuft; dabei ändert er nichts im Postfach. Nach dem Anlegen einer
								Postfach-Verbindung die App einmal neu starten (stop.bat, dann start.bat), damit er
								startet.
							</p>
							{#if !connection.enabled}
								<p class="hint" id={`${uid}-${connection.id}-picker`}>
									Zum Wählen aus dem Postfach die Verbindung einschalten.
								</p>
							{/if}
						{/if}
						<div class="buttons">
							{#if connection.type === 'mail'}
								<button
									class="secondary"
									type="button"
									aria-disabled={connection.enabled ? undefined : 'true'}
									aria-describedby={connection.enabled
										? undefined
										: `${uid}-${connection.id}-picker`}
									onclick={() => {
										if (connection.enabled) picking = connection;
									}}
								>
									Aus dem Postfach wählen
								</button>
							{/if}
							{#if connection.type !== 'mail'}
								<button
									class="secondary"
									type="button"
									aria-disabled={store.isRunning(connection.id) || !connection.enabled
										? 'true'
										: undefined}
									onclick={() => {
										if (!store.isRunning(connection.id) && connection.enabled)
											void runNow(connection);
									}}
								>
									{store.isRunning(connection.id) ? 'Wird abgerufen …' : 'Jetzt abrufen'}
								</button>
							{/if}
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
						: draft.type === 'mail'
							? 'Variable mit dem Passwort bzw. App-Passwort des Postfachs (Pflichtfeld)'
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
			{#if draft.type === 'mail'}
				<div class="field">
					<label for={ids.provider}>Anbieter</label>
					<select
						id={ids.provider}
						value={draft.mailProvider}
						onchange={(event) =>
							(draft = withMailProvider(draft, event.currentTarget.value as MailProvider))}
					>
						{#each MAIL_PROVIDERS as provider (provider)}
							<option value={provider}>{MAIL_PROVIDER_LABELS[provider]}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for={ids.user}>Benutzername, meist die E-Mail-Adresse (Pflichtfeld)</label>
					<input
						id={ids.user}
						type="text"
						maxlength="254"
						spellcheck="false"
						autocomplete="off"
						aria-required="true"
						aria-invalid={errors.mailUser ? 'true' : undefined}
						aria-describedby={errors.mailUser ? `${ids.user}-error` : undefined}
						bind:value={draft.mailUser}
					/>
					{#if errors.mailUser}
						<p id={`${ids.user}-error`} class="field-error">
							<ErrorIcon /><span>{errors.mailUser}</span>
						</p>
					{/if}
				</div>
			{/if}
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

{#if picking !== null}
	{@const connection = picking}
	<MailboxPicker
		label={connection.label}
		load={(limit, signal) => store.listMailbox(connection.id, limit, signal)}
		save={(uids) => store.importMailbox(connection.id, uids)}
		onclose={() => (picking = null)}
	/>
{/if}

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

	.switch,
	.reply {
		color: var(--color-text);
	}

	.reply {
		display: flex;
		gap: 0.375rem;
		align-items: baseline;
		font-size: 0.875rem;
		cursor: pointer;
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

	.refresh {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
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

	.secondary[aria-disabled='true'],
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
