<script lang="ts">
	import type { Connection } from '$lib/domain/connections';
	import { CREDENTIAL_TEXTS } from '$lib/domain/credentials';
	import { appContext } from '$lib/stores/context.svelte';
	import type { CredentialsStore } from '$lib/stores/credentials.svelte';
	import type { RestartStore } from '$lib/stores/restart.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import CredentialField from './CredentialField.svelte';
	import CredentialRestartNotice from './CredentialRestartNotice.svelte';

	// "Zugangsdaten" of a connection (BW-3, ADR-0075): one CredentialField per variable it names
	// (the secret and, for Telegram, the allowed IDs), in the details of its card and in "‹Name›
	// bearbeiten". With `notice` also the lasting hint "Neustart nötig …" (inside a modal, where the
	// hint of the page is covered). The way through Windows stands only as one line "Notfall" for the
	// administrator on the PC under Windows (the user's rule: everything from the browser; V6).
	let {
		id,
		connection,
		store,
		restart = null,
		notice = false,
		headingLevel = 5
	}: {
		/** ID of the heading; "Zugangsdaten …" of the card menu focuses it. */
		id: string;
		connection: Pick<Connection, 'id' | 'type' | 'secretEnv' | 'allowlistEnv' | 'mailProvider'>;
		store: CredentialsStore;
		restart?: RestartStore | null;
		notice?: boolean;
		/** 5 in the details of a card (below its name, h4), 3 in a modal (below its title). */
		headingLevel?: 3 | 5;
	} = $props();

	/** What the secret of a kind holds. */
	function secretLabel(): string {
		switch (connection.type) {
			case 'calendar':
				return 'Geheime iCal-Adresse';
			case 'telegram':
				return 'Bot-Token';
			case 'mail':
				return connection.mailProvider === 'gmail' ? 'App-Passwort' : 'Passwort des Postfachs';
			case 'notion':
				return 'Token der Integration';
			case 'github':
				return 'Token (optional)';
			case 'folder':
				return '';
		}
	}

	const fields = $derived(
		[
			{ name: connection.secretEnv, label: secretLabel(), hint: undefined },
			connection.type === 'telegram'
				? {
						name: connection.allowlistEnv,
						label: 'Erlaubte Chat- oder User-IDs (mit Komma getrennt)',
						hint: 'Zum Start reicht 0; die richtige ID zeigt die Einrichtung im Schritt „Chat freigeben“.'
					}
				: null
		].filter(
			(field): field is { name: string; label: string; hint: string | undefined } =>
				field !== null && field.name !== ''
		)
	);
</script>

{#if fields.length > 0}
	<section class="credentials" aria-labelledby={id}>
		<svelte:element this={`h${headingLevel}`} {id} class="heading" tabindex="-1">
			{CREDENTIAL_TEXTS.heading}
		</svelte:element>
		{#if notice}
			<CredentialRestartNotice {store} {restart} place={`credentials:${connection.id}:notice`} />
		{/if}
		{#if store.state === 'failed' && store.failure !== null && appContext.capabilities.scripts}
			<!-- The state could not be read: why, with "Details" for a failed request (FP-1). -->
			<SectionMessage
				tone={store.failure.problem !== null ? 'error' : 'warning'}
				compact
				problem={store.failure.problem}
			>
				{store.failure.message}
			</SectionMessage>
		{/if}
		{#each fields as field (field.name)}
			<CredentialField
				name={field.name}
				label={field.label}
				hint={field.hint}
				{store}
				{restart}
				place={`credentials:${connection.id}:${field.name}`}
			/>
		{/each}
		<p class="hint">Die App speichert nur die Namen der Windows-Variablen, nie ihre Werte.</p>
		{#if appContext.capabilities.scripts}
			<p class="hint">{CREDENTIAL_TEXTS.emergency}</p>
		{/if}
	</section>
{/if}

<style>
	.credentials {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.heading {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.heading:focus {
		outline: none;
	}

	.heading:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
