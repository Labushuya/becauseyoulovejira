<script lang="ts">
	import { keywordSummary } from '$lib/domain/channel-health';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import type { InboxKey } from '$lib/domain/inbox-keys';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import Modal from '../overlay/Modal.svelte';
	import ChannelIcon from './ChannelIcon.svelte';
	import ChannelKeywordsModal from './ChannelKeywordsModal.svelte';
	import InboxKeyCreateForm from './InboxKeyCreateForm.svelte';

	// Card "Eigener Eingang (API)" (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1): the access
	// keys of the user with name, start of the key, creation and last use, "Widerrufen …" per key,
	// "Zugangsschlüssel erzeugen …" (modal M, the key is shown once) and the keywords of the channel
	// "api" for entries of the mode "auto". The way to use a key stands in the help.
	let {
		store,
		importKeywords = null
	}: {
		store: InboxKeysStore;
		importKeywords?: ImportKeywordsStore | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let creating = $state(false);
	let editingKeywords = $state(false);
	let revoking = $state<InboxKey | null>(null);
	let revokeBusy = $state(false);
	let revokeError = $state<string | null>(null);

	const keywords = $derived(
		importKeywords?.state === 'ready' ? keywordSummary(importKeywords.settings.api.keywords) : null
	);

	function lastUsed(key: InboxKey): string {
		return key.lastUsedAt === null
			? 'noch nie benutzt'
			: `zuletzt ${formatBerlinDateTime(key.lastUsedAt)}`;
	}

	async function revoke() {
		if (revoking === null || revokeBusy) return;
		revokeBusy = true;
		revokeError = await store.revoke(revoking);
		revokeBusy = false;
		if (revokeError === null) revoking = null;
	}
</script>

<section class="card" aria-labelledby={headingId}>
	<header class="head">
		<ChannelIcon kind="api" />
		<div class="names">
			<h4 id={headingId}>Eigener Eingang (API)</h4>
			<p class="kind">Für eigene Skripte und die Erweiterung für WhatsApp Web</p>
		</div>
	</header>
	<p>
		Programme auf diesem Rechner legen mit einem Zugangsschlüssel Einträge in deinen Eingang. Ein
		Schlüssel kann nur das: nichts lesen, nichts ändern, nichts löschen.
	</p>

	{#if store.state === 'unavailable'}
		<SectionMessage tone="info" title={RESTART_NEEDED.title} headingLevel={4}>
			{RESTART_NEEDED.text}
		</SectionMessage>
	{:else if store.state === 'error'}
		<SectionMessage tone="error" live>
			{store.error}
			{#snippet actions()}
				<button class="button-secondary" type="button" onclick={() => void store.load()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state === 'ready'}
		{#if store.keys.length === 0}
			<EmptyState
				title="Noch kein Zugangsschlüssel"
				description="Erzeuge einen für jedes Programm, das Einträge bringen soll."
				size="compact"
				headingLevel={4}
			/>
		{:else}
			<ul class="keys" aria-label="Zugangsschlüssel">
				{#each store.keys as key (key.id)}
					<li>
						<div class="key">
							<span class="name">{key.name}</span>
							<span class="detail">
								<code>{key.tokenHint}…</code> · angelegt {formatBerlinDateTime(key.created)} · {lastUsed(
									key
								)}
							</span>
						</div>
						<button
							class="button-subtle"
							type="button"
							aria-haspopup="dialog"
							onclick={() => {
								revokeError = null;
								revoking = key;
							}}
						>
							Widerrufen …<span class="visually-hidden">: {key.name}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if keywords !== null}
			<p class="meta">Stichwörter für „mode: auto“: {keywords}</p>
		{/if}
	{:else}
		<p class="meta" role="status">Zugangsschlüssel werden geladen …</p>
	{/if}

	<footer class="actions">
		<button
			class="button-secondary"
			type="button"
			aria-haspopup="dialog"
			aria-disabled={store.state !== 'ready'}
			onclick={() => {
				if (store.state === 'ready') creating = true;
			}}
		>
			Zugangsschlüssel erzeugen …
		</button>
		{#if importKeywords !== null}
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				onclick={() => (editingKeywords = true)}
			>
				Stichwörter …<span class="visually-hidden">: Eigener Eingang (API)</span>
			</button>
		{/if}
		<a class="help" href={helpHref('eigener-eingang')}>So geht’s</a>
	</footer>
</section>

{#if creating}
	<Modal open size="m" title="Zugangsschlüssel erzeugen" onclose={() => (creating = false)}>
		<InboxKeyCreateForm {store} />
		{#snippet footer({ close })}
			<button class="button-secondary" type="button" onclick={close}>Schließen</button>
		{/snippet}
	</Modal>
{/if}

{#if editingKeywords && importKeywords !== null}
	<ChannelKeywordsModal
		kind="api"
		store={importKeywords}
		onclose={() => (editingKeywords = false)}
	/>
{/if}

<ConfirmDialog
	open={revoking !== null}
	title={`Zugangsschlüssel „${revoking?.name ?? ''}“ widerrufen?`}
	confirmLabel="Widerrufen"
	busy={revokeBusy}
	error={revokeError}
	onconfirm={() => void revoke()}
	oncancel={() => (revoking = null)}
>
	Programme und die Erweiterung, die ihn nutzen, können danach nichts mehr in den Eingang legen. Das
	lässt sich nicht rückgängig machen; du kannst aber jederzeit einen neuen Schlüssel erzeugen.
</ConfirmDialog>

<style>
	.card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.625rem;
		align-items: center;
	}

	.names {
		min-width: 0;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.kind,
	.meta,
	.detail {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	p {
		font-size: var(--font-size-body);
	}

	.keys {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.keys li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-top: 1px solid var(--color-line);
	}

	.key {
		display: grid;
		min-width: 0;
	}

	.name {
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.detail {
		overflow-wrap: anywhere;
	}

	.keys button {
		flex: none;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.help {
		color: var(--color-brand-text);
	}
</style>
