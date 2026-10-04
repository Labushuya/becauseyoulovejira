<script lang="ts">
	import { untrack } from 'svelte';
	import {
		INBOX_KEY_NAME_MAX_LENGTH,
		KEY_PLACEHOLDER,
		inboxKeyNameError,
		type CreatedInboxKey
	} from '$lib/domain/inbox-keys';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import Field from '../form/Field.svelte';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// Creates an access key of the own inbox (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1):
	// a name, then the key in plain text with "Kopieren". The key lives only in this component, or
	// in the owner that binds `created` (the assistant of WhatsApp Web shows it again in the step
	// "Schlüssel eintragen"); it is gone when the modal closes, and never stored. Used by the card
	// "Eigener Eingang (API)" and the assistant, so no dialog opens from a dialog.
	let {
		store,
		initialName = '',
		created = $bindable(null)
	}: {
		store: InboxKeysStore;
		initialName?: string;
		/** The new key in plain text, null before one was created. */
		created?: CreatedInboxKey | null;
	} = $props();

	// The first value only: the field belongs to the user once it is shown.
	let name = $state(untrack(() => initialName));
	let submitted = $state(false);
	let saving = $state(false);
	let serverError = $state<string | null>(null);

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
	}
</script>

{#if created === null}
	<form class="form" novalidate onsubmit={create} aria-busy={saving}>
		<Field
			label="Name des Schlüssels (Pflichtfeld)"
			hint="Woran du ihn später erkennst, etwa „WhatsApp Web auf dem Laptop“ oder „Skript Einkauf“."
			error={error ?? ''}
		>
			{#snippet control(field)}
				<input
					{...field}
					type="text"
					maxlength={INBOX_KEY_NAME_MAX_LENGTH}
					autocomplete="off"
					aria-required="true"
					bind:value={name}
				/>
			{/snippet}
		</Field>
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

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
