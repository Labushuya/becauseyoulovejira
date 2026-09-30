<script lang="ts">
	import { minuteClock } from '$lib/clock.svelte';
	import { inboxKeysInfo, inboxKeysStatus } from '$lib/domain/channel-card';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import type { InboxKey } from '$lib/domain/inbox-keys';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import ChipList from '../ChipList.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import Modal from '../overlay/Modal.svelte';
	import ChannelCard, { type CardAction } from './ChannelCard.svelte';
	import ChannelKeywordsModal from './ChannelKeywordsModal.svelte';
	import InboxKeyCreateForm from './InboxKeyCreateForm.svelte';

	// Card "Eigener Eingang (API)" (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1; since the plan
	// kanal-karten KK-2 a configuration of the building block ChannelCard): the main button
	// "Zugangsschlüssel erzeugen …" (modal M, the key is shown once), the keywords of the channel
	// "api" for entries of the mode "auto" and the help in the menu "•••", and in the details the
	// keys with name, start, creation, last use and "Widerrufen …" each, and the keywords as a list
	// of chips (ADR-0026, addendum KL). The state says whether a program has used a key yet. The way
	// to use a key stands in the help.
	let {
		store,
		importKeywords = null
	}: {
		store: InboxKeysStore;
		importKeywords?: ImportKeywordsStore | null;
	} = $props();

	const TITLE = 'Eigener Eingang (API)';
	const clock = minuteClock();

	let creating = $state(false);
	let editingKeywords = $state(false);
	let revoking = $state<InboxKey | null>(null);
	let revokeBusy = $state(false);
	let revokeError = $state<string | null>(null);

	const keywords = $derived(
		importKeywords?.state === 'ready' ? importKeywords.settings.api.keywords : null
	);
	const status = $derived(inboxKeysStatus(store.state, store.keys));
	const loading = $derived(store.state === 'idle' || store.state === 'loading');
	const info = $derived(
		store.state === 'ready'
			? inboxKeysInfo(store.keys, clock.now)
			: store.state === 'unavailable'
				? RESTART_NEEDED.title
				: store.state === 'error'
					? 'Die Zugangsschlüssel ließen sich nicht laden.'
					: 'Zugangsschlüssel werden geladen …'
	);
	const hint = $derived(
		store.state === 'unavailable'
			? { tone: 'info' as const, text: RESTART_NEEDED.text }
			: store.state === 'error' && store.error !== null
				? { tone: 'error' as const, text: store.error }
				: null
	);

	const primary = $derived.by((): CardAction => {
		if (store.state === 'error')
			return { label: 'Erneut versuchen', onselect: () => void store.load() };
		return {
			label: 'Zugangsschlüssel erzeugen …',
			dialog: true,
			locked: store.state !== 'ready',
			onselect: () => (creating = true)
		};
	});

	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (importKeywords !== null) {
			entries.push({
				label: 'Stichwörter …',
				dialog: true,
				onselect: () => (editingKeywords = true)
			});
		}
		entries.push({ label: 'Hilfe', href: helpHref('eigener-eingang') });
		return entries;
	});

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

<ChannelCard
	icon="api"
	title={TITLE}
	subtitle="Für eigene Skripte und die Erweiterung für WhatsApp Web"
	{status}
	{info}
	{hint}
	busy={loading}
	{primary}
	{menu}
>
	{#snippet details()}
		<p>
			Programme auf diesem Rechner legen mit einem Zugangsschlüssel Einträge in deinen Eingang. Ein
			Schlüssel kann nur das: nichts lesen, nichts ändern, nichts löschen.
		</p>
		{#if store.state === 'ready'}
			{#if store.keys.length === 0}
				<p>Erzeuge einen Zugangsschlüssel für jedes Programm, das Einträge bringen soll.</p>
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
		{/if}
		{#if keywords !== null}
			<dl>
				<div>
					<dt>Stichwörter für „mode: auto“</dt>
					<dd>
						<ChipList
							items={keywords}
							label={`Stichwörter von „${TITLE}“`}
							noun="Stichwörter"
							emptyText="keine"
						/>
					</dd>
				</div>
			</dl>
		{/if}
	{/snippet}
</ChannelCard>

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
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.keys button {
		flex: none;
	}
</style>
