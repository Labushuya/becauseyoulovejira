<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ExtensionInfo } from '$lib/data/extension';
	import type { StepCheck } from '$lib/domain/channel-setup';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { KEY_PLACEHOLDER, type CreatedInboxKey } from '$lib/domain/inbox-keys';
	import { CHANNEL_SEARCH_TEXT } from '$lib/domain/keywords';
	import {
		BROWSERS,
		BROWSER_LABELS,
		ENTER_STEPS,
		EXTENSION_FOLDER,
		LOAD_STEPS,
		WHATSAPP_WEB_STEPS,
		firstOpenStep,
		keyUsedSince,
		watchedKey,
		whatsappStepStates,
		type Browser
	} from '$lib/domain/whatsapp-web';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { helpHref } from '$lib/settings-sections';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import type { InboxTargetsStore } from '$lib/stores/inbox-targets.svelte';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import PcOnly from '../guidance/PcOnly.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Stepper from '../guidance/Stepper.svelte';
	import Tabs from '../guidance/Tabs.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import Modal from '../overlay/Modal.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import InboxKeyCreateForm from './InboxKeyCreateForm.svelte';
	import SetupCheck from './SetupCheck.svelte';

	// Assistant "WhatsApp Web einrichten" (ADR-0038 §4, ADR-0026 §4, plan eigener-eingang-whatsapp-web
	// EI-3): modal L with the stepper, one step at a time, like the assistants of the connections.
	// Schlüssel erzeugen → Erweiterung laden (Edge and Chrome, folder of the build) → Schlüssel
	// eintragen → Testen (the app sees "zuletzt benutzt" of the key after "Verbindung testen" in the
	// extension) → Stichwörter → Zielprojekt (optional, ADR-0049). A new key stays in this component
	// until the modal closes, so the step "Schlüssel eintragen" can offer it again; it is never stored.
	// The extension is loaded from a folder of the machine of the app and talks to the app there:
	// "Erweiterung laden" and "Schlüssel eintragen" show only for the administrator at that machine;
	// elsewhere the note "nur am PC" resp. "Bitte den Verwalter fragen." (KX-1, ADR-0057).
	let {
		inboxKeys,
		importKeywords = null,
		inboxTargets = null,
		projects = [],
		extension = null,
		appUrl,
		onclose
	}: {
		inboxKeys: InboxKeysStore;
		importKeywords?: ImportKeywordsStore | null;
		/** Target projects of the cards without a connection (ADR-0049). */
		inboxTargets?: InboxTargetsStore | null;
		/** Every project of the catalog, archived ones included. */
		projects?: readonly ProjectRef[];
		/** Folder and version of the build, null when the server does not know the route yet. */
		extension?: ExtensionInfo | null;
		/** Address of the app for the settings of the extension, e.g. http://127.0.0.1:8090. */
		appUrl: string;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const total = WHATSAPP_WEB_STEPS.length;
	const openedAt = Date.now();

	let created = $state<CreatedInboxKey | null>(null);
	let chosen = $state<number | null>(null);
	let browser = $state<Browser>('edge');
	let checking = $state(false);
	let heading = $state<HTMLElement>();

	const watched = $derived(watchedKey(inboxKeys.keys, created?.id ?? null));
	const facts = $derived({
		keys: inboxKeys.keys.length,
		used: keyUsedSince(watched, openedAt),
		keywords:
			importKeywords?.state === 'ready'
				? importKeywords.settings['whatsapp-web'].keywords.length
				: 0
	});
	// Opens at the first step the app does not see as done, once the keys are loaded.
	const start = $derived(inboxKeys.state === 'ready' ? untrack(() => firstOpenStep(facts)) : 0);
	const current = $derived(chosen ?? start);
	const step = $derived(WHATSAPP_WEB_STEPS[current] ?? WHATSAPP_WEB_STEPS[0]);
	const states = $derived(whatsappStepStates(facts, current));
	// The server names the folder only to the administrator at the machine of the app.
	const folder = $derived(extension?.folder || EXTENSION_FOLDER);

	const check = $derived<StepCheck>(
		watched === null
			? { tone: 'open', text: 'Erst in Schritt 1 einen Zugangsschlüssel erzeugen.' }
			: facts.used
				? {
						tone: 'done',
						text: `Die Erweiterung hat sich mit dem Schlüssel „${watched.name}“ gemeldet (zuletzt benutzt ${formatBerlinDateTime(watched.lastUsedAt ?? '')}).`
					}
				: {
						tone: 'open',
						text: `Seit dem Öffnen des Assistenten keine Meldung mit dem Schlüssel „${watched.name}“.`
					}
	);

	async function goTo(index: number) {
		if (index < 0 || index >= total) return;
		chosen = index;
		await tick();
		heading?.focus();
	}

	async function recheck() {
		if (checking) return;
		checking = true;
		await inboxKeys.load();
		checking = false;
	}
</script>

{#snippet keyBlock(key: CreatedInboxKey)}
	<CodeBlock
		code={`{{${KEY_PLACEHOLDER}}}`}
		label="Zugangsschlüssel"
		placeholders={{ [KEY_PLACEHOLDER]: { label: 'Zugangsschlüssel', secret: false } }}
		values={{ [KEY_PLACEHOLDER]: key.token }}
		wrap
	/>
{/snippet}

<Modal
	open
	size="l"
	title="WhatsApp Web einrichten"
	initialFocus={heading ?? null}
	onclose={() => onclose()}
>
	<div class="setup">
		<div class="top">
			<Stepper
				steps={WHATSAPP_WEB_STEPS.map((entry, index) => ({
					id: entry.id,
					label: entry.label,
					state: states[index] ?? 'open'
				}))}
				{current}
				onselect={(index) => void goTo(index)}
			/>
		</div>

		<section class="step" aria-labelledby={headingId}>
			<h3 id={headingId} tabindex="-1" bind:this={heading}>
				Schritt {current + 1} von {total}: {step.label}
			</h3>

			{#if step.id === 'key'}
				<p>
					Die Erweiterung meldet sich mit einem eigenen Zugangsschlüssel bei der App. Er kann nur
					Einträge in deinen Eingang legen, und du kannst ihn jederzeit widerrufen.
				</p>
				{#if inboxKeys.state === 'unavailable'}
					<SectionMessage tone="info" title={RESTART_NEEDED.title} headingLevel={4}>
						{RESTART_NEEDED.text}
					</SectionMessage>
				{:else}
					{#if created === null && inboxKeys.keys.length > 0}
						<p class="hint">
							Du hast schon Zugangsschlüssel. Ein eigener für die Erweiterung lässt sich einzeln
							widerrufen.
						</p>
					{/if}
					<InboxKeyCreateForm store={inboxKeys} initialName="WhatsApp Web" bind:created />
				{/if}
			{:else if step.id === 'load'}
				<PcOnly need="pc">
					<p>
						Die Erweiterung liegt im Ordner der App. Du lädst sie einmal als „entpackte
						Erweiterung“; sie steht nicht im Store und sendet nur an diese App.
					</p>
					<Tabs
						label="Browser"
						tabs={BROWSERS.map((id) => ({ id, label: BROWSER_LABELS[id] }))}
						selected={browser}
						onselect={(id) => (browser = id)}
					>
						{#snippet panel(id)}
							<ol class="actions">
								{#each LOAD_STEPS[id] as action (action)}
									<li>{action}</li>
								{/each}
							</ol>
						{/snippet}
					</Tabs>
					<CodeBlock code={folder} label="Ordner der Erweiterung" wrap />
					{#if extension === null}
						<p class="hint">
							Der Ordner liegt im Ordner der App (dort, wo start.bat liegt) unter
							erweiterung-whatsapp-web.
						</p>
					{:else if !extension.built}
						<SectionMessage tone="warning" compact>
							Der Ordner fehlt noch. Er entsteht beim Bauen der App (scripts\build.ps1).
						</SectionMessage>
					{:else}
						<p class="hint">Version {extension.version} ist gebaut.</p>
					{/if}
					<p class="hint">
						Nach einem Update der App auf der Seite der Erweiterungen bei „becauseyoulovejira für
						WhatsApp Web“ auf „Neu laden“ klicken.
					</p>
				</PcOnly>
			{:else if step.id === 'enter'}
				<ol class="actions">
					{#each ENTER_STEPS as action (action)}
						<li>{action}</li>
					{/each}
				</ol>
				<CodeBlock code={appUrl} label="App-Adresse" />
				{#if created !== null}
					{@render keyBlock(created)}
				{:else}
					<p class="hint">
						Den Schlüssel hast du in Schritt 1 kopiert. Hast du ihn nicht mehr, erzeuge dort einen
						neuen.
					</p>
				{/if}
			{:else if step.id === 'test'}
				<p>
					Öffne web.whatsapp.com und klicke in der Erweiterung auf „Verbindung testen“. Dort steht
					dann „Verbunden …“ und „WhatsApp Web erkannt“. Danach hier „Prüfen“.
				</p>
				<SetupCheck {check}>
					{#snippet actions()}
						<button
							class="button-subtle"
							type="button"
							aria-disabled={checking}
							aria-busy={checking}
							onclick={() => void recheck()}
						>
							{checking ? 'Wird geprüft …' : 'Prüfen'}
						</button>
					{/snippet}
				</SetupCheck>
				<ul class="more-list">
					<li>„App nicht erreichbar“: Läuft die App unter der Adresse aus Schritt 3?</li>
					<li>„Zugangsschlüssel ungültig oder widerrufen“: in Schritt 1 einen neuen erzeugen.</li>
					<li>
						„Seitenstruktur nicht erkannt“: WhatsApp hat seine Seite geändert; die Erweiterung
						braucht ein Update und tut bis dahin nichts.
					</li>
				</ul>
			{:else if step.id === 'target'}
				<p>
					Optional: Neue Einträge aus WhatsApp Web bekommen dieses Projekt, und beim Umwandeln ist
					es vorbelegt. Ohne Zielprojekt bleibt das Projekt beim Umwandeln leer; ändern kannst du es
					jederzeit an der Karte.
				</p>
				{#if inboxTargets !== null && (inboxTargets.state === 'ready' || inboxTargets.state === 'unavailable')}
					<CardTargetProject
						id={`${uid}-target`}
						name="WhatsApp Web"
						entries="Neue Einträge aus WhatsApp Web"
						value={inboxTargets.targets['whatsapp-web'] || null}
						{projects}
						ready={inboxTargets.state === 'ready'}
						onsave={(project) => inboxTargets.save('whatsapp-web', project, 'WhatsApp Web')}
					/>
				{/if}
			{:else}
				<p>
					„In den Eingang“ an einer Nachricht übernimmt sie immer. Mit dem Schalter „Automatisch
					(nur mit Stichwort)“ in der Erweiterung kommen neue Nachrichten des offenen Chats nur mit
					einem dieser Stichwörter.
				</p>
				{#if importKeywords?.state === 'ready'}
					<KeywordEditor
						keywords={importKeywords.settings['whatsapp-web'].keywords}
						name="WhatsApp Web"
						description={CHANNEL_SEARCH_TEXT['whatsapp-web']}
						emptyText="Keine Stichwörter: Automatisch gesendete Nachrichten werden nicht übernommen, „In den Eingang“ schon."
						onsave={(next, announcement) =>
							importKeywords.save(
								'whatsapp-web',
								{ keywords: next, matchBody: false },
								`WhatsApp Web: ${announcement}`
							)}
					/>
				{:else if importKeywords?.state === 'unavailable'}
					<SectionMessage tone="info" title={RESTART_NEEDED.title} headingLevel={4}>
						{RESTART_NEEDED.text}
					</SectionMessage>
				{/if}
				<SectionMessage tone="info" compact>
					Inoffiziell: Die Erweiterung liest nur, was du im offenen Tab siehst, und nur solange er
					offen ist. Nach Updates von WhatsApp kann sie eine Anpassung brauchen.
					<a href={helpHref('whatsapp-web')} target="_blank" rel="noopener"
						>Mehr in der Hilfe (neuer Tab)</a
					>
				</SectionMessage>
			{/if}
		</section>
	</div>

	{#snippet footer({ close })}
		<button class="button-subtle later" type="button" onclick={close}>Später fortsetzen</button>
		{#if current > 0}
			<button class="button-secondary" type="button" onclick={() => void goTo(current - 1)}>
				Zurück
			</button>
		{/if}
		{#if current === total - 1}
			<button class="button-primary" type="button" onclick={close}>Fertig</button>
		{:else}
			<button class="button-primary" type="button" onclick={() => void goTo(current + 1)}>
				Weiter
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.setup {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}

	/* The stepper stays at the top while the step scrolls (plan EH-5 §3.7). */
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-bottom: 0.75rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-line);
	}

	.step {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	h3:focus {
		outline: none;
	}

	h3:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	p,
	li {
		font-size: var(--font-size-body);
	}

	.actions,
	.more-list {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding-left: 1.25rem;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.later {
		margin-right: auto;
	}

	a {
		color: var(--color-brand-text);
	}
</style>
