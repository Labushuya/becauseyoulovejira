<script lang="ts">
	import { untrack } from 'svelte';
	import {
		INBOX_KEY_NAME_MAX_LENGTH,
		KEY_PLACEHOLDER,
		inboxKeyNameError,
		type CreatedInboxKey
	} from '$lib/domain/inbox-keys';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// Creates an access key of the own inbox (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1):
	// a name, then the key in plain text with "Kopieren", exactly once. The key lives only in this
	// component; it is gone when the component leaves (closing the modal or the step of the
	// assistant). Used by the card "Eigener Eingang (API)" and the assistant of WhatsApp Web, so no
	// dialog opens from a dialog.
	let {
		store,
		initialName = '',
		oncreated
	}: {
		store: InboxKeysStore;
		initialName?: string;
		/** After the key was created (e.g. to move on in the assistant). */
		oncreated?: (key: CreatedInboxKey) => void;
	} = $props();

	const uid = $props.id();
	const ids = { name: `${uid}-name`, hint: `${uid}-hint` };

	// The first value only: the field belongs to the user once it is shown.
	let name = $state(untrack(() => initialName));
	let submitted = $state(false);
	let saving = $state(false);
	let serverError = $state<string | null>(null);
	let created = $state<CreatedInboxKey | null>(null);

	const nameError = $derived(submitted ? inboxKeyNameError(name) : null);
	const error = $derived(nameError ?? serverError);

	async function create(event: Event) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		serverError = null;
		if (inboxKeyNameError(name) !== null) return;
		saving = true;
		const result = await store.create(name);
		saving = false;
		if (result === null) return;
		if ('error' in result) {
			serverError = result.error;
			return;
		}
		created = result.key;
		oncreated?.(result.key);
	}
</script>

{#if created === null}
	<form class="form" novalidate onsubmit={create} aria-busy={saving}>
		<div class="field">
			<label for={ids.name}>Name des Schlüssels (Pflichtfeld)</label>
			<input
				id={ids.name}
				type="text"
				maxlength={INBOX_KEY_NAME_MAX_LENGTH}
				autocomplete="off"
				aria-required="true"
				aria-invalid={error !== null ? 'true' : undefined}
				aria-describedby={error !== null ? `${ids.name}-error ${ids.hint}` : ids.hint}
				bind:value={name}
			/>
			<p id={ids.hint} class="hint">
				Woran du ihn später erkennst, etwa „WhatsApp Web auf dem Laptop“ oder „Skript Einkauf“.
			</p>
			{#if error !== null}
				<p id={`${ids.name}-error`} class="field-error"><ErrorIcon /><span>{error}</span></p>
			{/if}
		</div>
		<div>
			<button class="button-primary" type="submit" aria-disabled={saving}>
				{saving ? 'Wird erzeugt …' : 'Schlüssel erzeugen'}
			</button>
		</div>
	</form>
{:else}
	<div class="created">
		<SectionMessage tone="success" title={`Zugangsschlüssel „${created.name}“ erzeugt`} live>
			Kopiere ihn jetzt. Er wird nur dieses eine Mal angezeigt; die App speichert nur einen
			Prüfwert, aus dem er sich nicht zurückrechnen lässt.
		</SectionMessage>
		<CodeBlock
			code={`{{${KEY_PLACEHOLDER}}}`}
			label="Zugangsschlüssel"
			placeholders={{ [KEY_PLACEHOLDER]: { label: 'Zugangsschlüssel', secret: false } }}
			values={{ [KEY_PLACEHOLDER]: created.token }}
			wrap
		/>
		<p class="hint">
			Wer den Schlüssel hat, kann Einträge in deinen Eingang legen, sonst nichts. Verlierst du ihn,
			widerrufe ihn und erzeuge einen neuen.
		</p>
	</div>
{/if}

<style>
	.form,
	.created {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
