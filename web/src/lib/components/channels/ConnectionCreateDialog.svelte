<script lang="ts">
	import {
		CONNECTION_TYPES,
		CONNECTION_TYPE_LABELS,
		MAIL_PROVIDERS,
		MAIL_PROVIDER_LABELS,
		connectionDraftErrors,
		emptyConnectionDraft,
		withMailProvider,
		type ConnectionDraft,
		type ConnectionType,
		type MailProvider
	} from '$lib/domain/connections';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Verbindung anlegen" (E4 plan, package 10; ADR-0026 section 3): until the setup assistant of
	// EH-5 the catalog opens the former form "Neue Verbindung" as a modal of size M, preset with the
	// kind (and provider) of the tile, so creating a connection is always possible. Only the names of
	// the variables are entered, never their values (ADR-0018). The dialog closes after creating.
	let {
		store,
		type,
		provider = 'webde',
		onclose
	}: {
		store: ConnectionsStore;
		type: ConnectionType;
		provider?: MailProvider;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		type: `${uid}-type`,
		label: `${uid}-label`,
		secret: `${uid}-secret`,
		allowlist: `${uid}-allowlist`,
		provider: `${uid}-provider`,
		user: `${uid}-user`
	};

	function initialDraft(): ConnectionDraft {
		const draft = emptyConnectionDraft(type);
		return type === 'mail' ? withMailProvider(draft, provider) : draft;
	}

	let draft = $state<ConnectionDraft>(initialDraft());
	let submitted = $state(false);
	let saving = $state(false);
	let serverFields = $state<Record<string, string>>({});
	let formMessage = $state<string | null>(null);

	const clientErrors = $derived(submitted ? connectionDraftErrors(draft) : {});
	const errors = $derived({
		label: clientErrors.label ?? serverFields.label,
		secretEnv: clientErrors.secretEnv ?? serverFields.secret_env,
		allowlistEnv:
			clientErrors.allowlistEnv ?? (draft.type === 'telegram' ? serverFields.settings : undefined),
		mailUser: clientErrors.mailUser ?? (draft.type === 'mail' ? serverFields.settings : undefined)
	});

	function chooseType(next: ConnectionType) {
		draft = emptyConnectionDraft(next);
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
			onclose();
			return;
		}
		serverFields = { ...result.fields };
		formMessage = result.message;
	}
</script>

<Modal open size="m" title="Verbindung anlegen" busy={saving} onclose={() => onclose()}>
	<form id={ids.form} class="form" novalidate onsubmit={create}>
		<div class="field">
			<label for={ids.type}>Art</label>
			<select
				id={ids.type}
				value={draft.type}
				onchange={(event) => chooseType(event.currentTarget.value as ConnectionType)}
			>
				{#each CONNECTION_TYPES as option (option)}
					<option value={option}>{CONNECTION_TYPE_LABELS[option]}</option>
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
					{#each MAIL_PROVIDERS as option (option)}
						<option value={option}>{MAIL_PROVIDER_LABELS[option]}</option>
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
			Hier nur den Namen eintragen, nie den Wert. Den Wert setzt du in Windows, wie in der Anleitung
			unter „Anleitungen“ beschrieben.
		</p>
		{#if formMessage !== null}
			<p class="alert-error" role="alert"><ErrorIcon /><span>{formMessage}</span></p>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" aria-disabled={saving} onclick={close}>
			Abbrechen
		</button>
		<button class="button-primary" type="submit" form={ids.form} aria-disabled={saving}>
			{saving ? 'Wird angelegt …' : 'Verbindung anlegen'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input,
	select {
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	input[type='text'] {
		width: 100%;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
