<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		CHAT_COMMAND,
		CONTROL_PANEL_STEPS,
		DEFAULT_ALLOWLIST,
		chatIdFromHint,
		SETUP_TITLES,
		SETX_WAY_KEY,
		defaultVariable,
		isSetxWay,
		matchesSetupKind,
		openCheckBefore,
		setupProgress,
		setupStepKey,
		setupSteps,
		stepCheck,
		stepStates,
		type SetupFacts,
		type SetupKind,
		type SetupStep,
		type SetxWay
	} from '$lib/domain/channel-setup';
	import {
		KEYWORD_SEARCH_TEXT,
		NO_KEYWORDS_WARNING,
		runResultText,
		type Connection
	} from '$lib/domain/connections';
	import { checkText } from '$lib/domain/notion';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import HostPlatformNote from '../guidance/HostPlatformNote.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Stepper from '../guidance/Stepper.svelte';
	import Tabs from '../guidance/Tabs.svelte';
	import Modal from '../overlay/Modal.svelte';
	import SecretValueField from './SecretValueField.svelte';
	import SetupCheck from './SetupCheck.svelte';
	import SetupConnectForm from './SetupConnectForm.svelte';

	// Setup assistant (ADR-0026 section 4, plan EH-5 §3.7/§3.8/§3.11): a modal L "‹Dienst›
	// einrichten" with the stepper at the top of the content, one step at a time and the footer
	// "Später fortsetzen", "Zurück" and "Weiter"/"Fertig". The owner keeps kind and connection in the
	// address (?einrichten=<art>&verbindung=<id>), so a reload opens the same setup. The first step
	// shown comes from facts of the server (setupProgress), the step looked at last from
	// sessionStorage (only its number). "Weiter" is never locked; an open check of an earlier step
	// is named at the top of the next one. While the assistant is open it watches its connection
	// through realtime, so a run of the server shows without polling. Nothing is dirty: creating and
	// keywords save at once, a typed value is dropped on purpose when the modal closes. Notion
	// (ADR-0041) ends with "Verbindung prüfen"; its result offers "Listen übernehmen …", which closes
	// the assistant and opens the import dialog (no dialog from a dialog).
	let {
		kind,
		connectionId,
		store,
		notion,
		onconnection,
		onimport,
		onclose
	}: {
		kind: SetupKind;
		/** Connection of the address; null before it is created. */
		connectionId: string | null;
		store: ConnectionsStore;
		/** Notion import: "Verbindung prüfen" of the last step. */
		notion: NotionStore;
		/** A connection was created; the owner writes its ID into the address. */
		onconnection: (id: string) => void;
		/** Closes the assistant and opens the import dialog of a Notion connection. */
		onimport: (connection: Connection) => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-step`;
	const steps = $derived(setupSteps(kind));
	const total = $derived(steps.length);

	const connection = $derived<Connection | null>(
		connectionId === null
			? null
			: (store.connections.find(
					(item) => item.id === connectionId && matchesSetupKind(item, kind)
				) ?? null)
	);
	const missing = $derived(connectionId !== null && store.state === 'ready' && connection === null);
	const facts = $derived<SetupFacts>({
		connection,
		secretStatus: connection === null ? null : store.status(connection.id)
	});
	const variable = $derived(connection?.secretEnv ?? defaultVariable(kind));
	/** Telegram: name of the variable with the allowed IDs. */
	const allowlist = $derived(connection?.allowlistEnv || DEFAULT_ALLOWLIST);
	/** Names of the variables in the commands; no secrets. */
	const fixedValues = $derived({ variable, allowlist });
	/** Telegram: the chat ID of the last run that is not allowed yet (plan §3.13). */
	const chatId = $derived(connection === null ? null : chatIdFromHint(connection.lastHint));
	/**
	 * Postfächer: the helper fetches every 5 minutes, so the last step waits for the first run (EH-7);
	 * since the user's request after #84 it also offers "Jetzt abrufen", which asks the helper through
	 * the run route to fetch at once, and "Hilfsprozess prüfen".
	 */
	const mailbox = $derived(kind === 'webde' || kind === 'gmail');

	function session(): Storage | null {
		try {
			return window.sessionStorage;
		} catch {
			return null;
		}
	}

	function local(): Storage | null {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	}

	/** The step looked at last for this connection in this tab; only its number. */
	function remembered(id: string | null): number | null {
		if (id === null) return null;
		try {
			const value = Number(session()?.getItem(setupStepKey(id)) ?? '');
			return Number.isInteger(value) && value >= 0 ? value : null;
		} catch {
			return null;
		}
	}

	function remember(index: number) {
		if (connection === null) return;
		try {
			session()?.setItem(setupStepKey(connection.id), String(index));
		} catch {
			// Only the way back to the step is lost; the progress still comes from the server.
		}
	}

	/** First step: the first open one after the facts, or a later one looked at in this tab. */
	const initial = $derived(
		Math.min(
			Math.max(setupProgress(kind, facts), remembered(connectionId) ?? 0),
			Math.max(total - 1, 0)
		)
	);
	/** Step chosen by the user; until then the assistant follows the facts. */
	let chosen = $state<number | null>(null);
	const current = $derived(chosen ?? initial);
	const step = $derived<SetupStep | undefined>(steps[current]);
	const states = $derived(stepStates(kind, facts, current));
	const warning = $derived(openCheckBefore(kind, facts, current));
	const check = $derived(step === undefined ? null : stepCheck(kind, step.id, facts));
	const last = $derived(current >= total - 1);

	let overview = $state(false);
	let heading = $state<HTMLElement>();

	function readWay(): SetxWay {
		try {
			const value = local()?.getItem(SETX_WAY_KEY);
			return isSetxWay(value) ? value : 'eingabeaufforderung';
		} catch {
			return 'eingabeaufforderung';
		}
	}

	let way = $state<SetxWay>(readWay());

	function chooseWay(next: SetxWay) {
		way = next;
		try {
			local()?.setItem(SETX_WAY_KEY, next);
		} catch {
			// The choice holds for this page.
		}
	}

	async function goTo(index: number) {
		if (index < 0 || index >= total) return;
		chosen = index;
		overview = false;
		remember(index);
		await tick();
		heading?.focus();
	}

	/** Keeps the step as it is while an action changes the facts (no jump under the pointer). */
	function hold() {
		chosen = current;
	}

	/** ID of the found connection; a primitive, so updates of the record do not rerun effects. */
	const watchedId = $derived(connection?.id ?? null);
	const stepId = $derived(step?.id ?? null);

	// The step "Neu starten" asks the server again whether it sees the variable, once per visit.
	$effect(() => {
		const id = watchedId;
		if (stepId !== 'restart' || id === null) return;
		untrack(() => void store.checkStatus(id));
	});

	// Realtime on exactly this connection while the assistant is open (plan §3.8, no polling).
	$effect(() => {
		const id = watchedId;
		if (id === null) return;
		return untrack(() => store.watch(id));
	});

	function created(next: Connection) {
		hold();
		remember(current);
		onconnection(next.id);
	}

	async function saveKeywords(keywords: string[], announcement: string): Promise<string | null> {
		if (connection === null) return null;
		hold();
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

	let runError = $state<string | null>(null);
	const lastRun = $derived(connection === null ? null : store.lastRun(connection.id));
	const running = $derived(connection !== null && store.isRunning(connection.id));

	async function runNow() {
		if (connection === null) return;
		hold();
		runError = null;
		const result = await store.runNow(connection.id, { announce: false });
		if (!result.ok && result.message !== null) runError = result.message;
	}

	async function recheck() {
		if (connection === null) return;
		hold();
		await store.checkStatus(connection.id);
	}

	/** "Erneut prüfen" while a mailbox waits for its first run: reads the connection again. */
	async function reload() {
		if (connection === null) return;
		hold();
		await store.refresh(connection.id);
	}

	/** Result of "Hilfsprozess prüfen": only on a click, the helper logs in to the mailbox. */
	let helper = $state<'ok' | 'unavailable' | { message: string; hint: string } | null>(null);
	/** "Hilfsprozess prüfen" runs (it logs in to the mailbox, which takes a moment). */
	let probing = $state(false);

	async function probe() {
		if (connection === null || probing) return;
		hold();
		helper = null;
		probing = true;
		const outcome = await store.probeHelper(connection.id).finally(() => (probing = false));
		if (outcome === null) return;
		helper =
			outcome.kind === 'ok'
				? 'ok'
				: outcome.kind === 'unavailable'
					? 'unavailable'
					: { message: outcome.message, hint: outcome.hint };
	}

	function stepIndex(id: SetupStep['id']): number {
		return steps.findIndex((entry) => entry.id === id);
	}

	/** Notion: answer of "Verbindung prüfen" on this page, null before the first. */
	const notionCheck = $derived(connection === null ? null : notion.lastCheck(connection.id));
	const notionChecking = $derived(connection !== null && notion.isChecking(connection.id));

	async function checkNotion() {
		if (connection === null) return;
		hold();
		await notion.check(connection.id, connection.label, { announce: false });
		// The check line reads the facts of the server; realtime brings them, this is the fallback.
		await store.refresh(connection.id);
	}
</script>

{#snippet links(entry: SetupStep)}
	{#if entry.links.length > 0}
		<p class="links">
			{#each entry.links as link (link.href)}
				<ExternalLink href={link.href}>{link.text}</ExternalLink>
			{/each}
		</p>
	{/if}
{/snippet}

{#snippet actionsList(entry: SetupStep)}
	{#if entry.actions.length > 0}
		<ol class="actions">
			{#each entry.actions as action (action)}
				<li>{action}</li>
			{/each}
		</ol>
	{/if}
{/snippet}

{#snippet commandBlocks(entry: SetupStep, withValue: boolean)}
	{#each entry.commands as command (command.template)}
		<CodeBlock
			code={command.template}
			label={command.label}
			placeholders={command.placeholders}
			values={fixedValues}
			copyable={command.copyable}
		/>
		{#if withValue && command.value !== undefined}
			<SecretValueField
				label={command.label}
				template={command.template}
				placeholders={command.placeholders}
				name={command.value}
				fixed={fixedValues}
				normalize={command.normalize ?? 'other'}
			/>
		{/if}
	{/each}
{/snippet}

{#snippet controlPanel()}
	<ol class="actions">
		{#each CONTROL_PANEL_STEPS as action (action)}
			<li>{action}</li>
		{/each}
	</ol>
	<CodeBlock code={variable} label="Name der Variablen" />
	{#if kind === 'telegram'}
		<CodeBlock code={allowlist} label="Name der Variablen für die IDs (Wert vorläufig 0)" />
	{/if}
	<p class="hint">Der Wert geht so nicht über die Zwischenablage.</p>
{/snippet}

{#snippet runBlock()}
	{#if connection !== null}
		<div>
			<button
				class="button-secondary"
				type="button"
				aria-busy={running}
				aria-disabled={running}
				onclick={() => void runNow()}
			>
				{running ? 'Wird abgerufen …' : 'Jetzt abrufen'}
			</button>
		</div>
		{#if lastRun !== null}
			<SectionMessage
				tone={lastRun.status === 'ok' ? 'success' : lastRun.status === 'error' ? 'error' : 'info'}
				title={lastRun.status === 'ok' ? 'Abgerufen' : undefined}
				compact={lastRun.status !== 'ok'}
				live
				headingLevel={4}
			>
				{runResultText(connection.label, lastRun)}
				{#snippet actions()}
					{#if lastRun?.status === 'missing' && stepIndex('restart') >= 0}
						<button
							class="button-subtle"
							type="button"
							onclick={() => void goTo(stepIndex('restart'))}
						>
							Zu Schritt {stepIndex('restart') + 1}
						</button>
					{/if}
				{/snippet}
			</SectionMessage>
		{/if}
		{#if runError !== null}
			<SectionMessage tone="error" compact live>{runError}</SectionMessage>
		{/if}
	{/if}
{/snippet}

{#snippet body(entry: SetupStep)}
	{#if entry.id === 'connect'}
		{#if connection === null}
			<SetupConnectForm {kind} {store} oncreated={created} />
		{:else if mailbox}
			<KeywordEditor
				keywords={connection.keywords}
				name={connection.label}
				description={KEYWORD_SEARCH_TEXT[connection.type]}
				emptyText={NO_KEYWORDS_WARNING}
				onsave={saveKeywords}
			/>
		{/if}
	{:else if entry.id === 'variable' || entry.id === 'token'}
		<Tabs
			label="Weg zur Variablen"
			tabs={[
				{ id: 'eingabeaufforderung', label: 'Eingabeaufforderung' },
				{ id: 'systemsteuerung', label: 'Systemsteuerung' }
			]}
			selected={way}
			onselect={chooseWay}
		>
			{#snippet panel(id)}
				{#if id === 'eingabeaufforderung'}
					{@render commandBlocks(entry, true)}
				{:else}
					{@render controlPanel()}
				{/if}
			{/snippet}
		</Tabs>
	{:else if entry.id === 'restart'}
		{@render commandBlocks(entry, false)}
		{#if connection !== null && facts.secretStatus !== null && check?.tone === 'open'}
			<SectionMessage tone="warning" compact>
				Hast du setx schon ausgeführt? Dann starte die App neu: neu-starten.bat im Ordner app.
				Danach „Erneut prüfen“.
			</SectionMessage>
		{/if}
	{:else if entry.id === 'keywords'}
		{#if connection !== null}
			<KeywordEditor
				keywords={connection.keywords}
				name={connection.label}
				description={KEYWORD_SEARCH_TEXT[connection.type]}
				emptyText={NO_KEYWORDS_WARNING}
				onsave={saveKeywords}
			/>
		{/if}
	{:else if entry.id === 'first-run' && mailbox}
		{#if connection !== null}
			{@render runBlock()}
			<div class="row">
				<button
					class="button-secondary"
					type="button"
					aria-busy={probing}
					aria-disabled={probing}
					onclick={() => void probe()}
				>
					{probing ? 'Hilfsprozess wird geprüft …' : 'Hilfsprozess prüfen'}
				</button>
			</div>
			{#if helper === 'ok'}
				<SectionMessage tone="success" title="Hilfsprozess läuft" live headingLevel={4}>
					Der Mail-Hilfsprozess läuft und erreicht dein Postfach.
				</SectionMessage>
			{:else if helper === 'unavailable'}
				<SectionMessage tone="info" live>
					Der Mail-Hilfsprozess läuft nicht. neu-starten.bat startet ihn, sobald eine eingeschaltete
					Postfach-Verbindung besteht und die App die Variable sieht.
				</SectionMessage>
			{:else if helper !== null}
				<SectionMessage tone="error" live>{helper.message} {helper.hint}</SectionMessage>
			{/if}
		{/if}
	{:else if entry.id === 'chat'}
		{@render runBlock()}
		{#if chatId !== null}
			<SectionMessage tone="info" title={`Erkannte Chat-ID: ${chatId}`} live headingLevel={4}>
				Gib diese ID frei: den Befehl ausführen, dann die App neu starten (neu-starten.bat) und
				erneut „Jetzt abrufen“.
			</SectionMessage>
			<CodeBlock
				code={CHAT_COMMAND.template}
				label={CHAT_COMMAND.label}
				placeholders={CHAT_COMMAND.placeholders}
				values={{ ...fixedValues, ids: chatId }}
			/>
			<SecretValueField
				label="Befehl für mehrere IDs"
				template={CHAT_COMMAND.template}
				placeholders={CHAT_COMMAND.placeholders}
				name="ids"
				fixed={fixedValues}
			/>
		{/if}
	{:else if entry.id === 'check'}
		{#if connection !== null}
			<div>
				<button
					class="button-secondary"
					type="button"
					aria-busy={notionChecking}
					aria-disabled={notionChecking}
					onclick={() => void checkNotion()}
				>
					{notionChecking ? 'Wird geprüft …' : 'Verbindung prüfen'}
				</button>
			</div>
			{#if notionCheck !== null}
				{#if notionCheck.kind === 'ok'}
					<SectionMessage
						tone={notionCheck.value.shared ? 'success' : 'info'}
						title={notionCheck.value.shared ? 'Verbindung steht' : undefined}
						compact={!notionCheck.value.shared}
						live
						headingLevel={4}
					>
						{checkText(notionCheck.value)}
						{#snippet actions()}
							{#if notionCheck?.kind === 'ok' && notionCheck.value.shared && connection !== null}
								<button
									class="button-subtle"
									type="button"
									aria-haspopup="dialog"
									onclick={() => {
										if (connection !== null) onimport(connection);
									}}
								>
									Listen übernehmen …
								</button>
							{/if}
						{/snippet}
					</SectionMessage>
				{:else}
					<SectionMessage tone={notionCheck.kind === 'error' ? 'error' : 'info'} live>
						{notionCheck.message}
						{#snippet actions()}
							{#if notionCheck?.kind === 'missing' && stepIndex('restart') >= 0}
								<button
									class="button-subtle"
									type="button"
									onclick={() => void goTo(stepIndex('restart'))}
								>
									Zu Schritt {stepIndex('restart') + 1}
								</button>
							{/if}
						{/snippet}
					</SectionMessage>
				{/if}
			{/if}
		{/if}
	{:else if entry.id === 'first-run'}
		{#if kind === 'telegram' && connection !== null}
			<KeywordEditor
				keywords={connection.keywords}
				name={connection.label}
				description={KEYWORD_SEARCH_TEXT[connection.type]}
				emptyText={NO_KEYWORDS_WARNING}
				onsave={saveKeywords}
			/>
		{/if}
		{@render runBlock()}
	{/if}
{/snippet}

{#snippet more(entry: SetupStep)}
	{#if entry.more.length > 0}
		<details class="more">
			<summary>Mehr dazu</summary>
			<ul>
				{#each entry.more as text (text)}
					<li>{text}</li>
				{/each}
			</ul>
		</details>
	{/if}
{/snippet}

<Modal
	open
	size="l"
	title={`${SETUP_TITLES[kind]} einrichten`}
	initialFocus={heading ?? null}
	onclose={() => onclose()}
>
	<div class="setup">
		<div class="top">
			<Stepper
				steps={steps.map((entry, index) => ({
					id: entry.id,
					label: entry.label,
					state: states[index] ?? 'open'
				}))}
				{current}
				onselect={(index) => void goTo(index)}
			/>
			<div class="view">
				<button
					class="button-subtle"
					type="button"
					aria-pressed={overview}
					onclick={() => (overview = !overview)}
				>
					Alle Schritte anzeigen
				</button>
			</div>
		</div>

		{#if store.state === 'loading' || store.state === 'idle'}
			<p class="hint" role="status">Verbindungen werden geladen …</p>
		{/if}
		{#if missing}
			<SectionMessage tone="info" compact live>
				Diese Verbindung gibt es nicht mehr. Im ersten Schritt legst du eine neue an.
			</SectionMessage>
		{/if}
		<HostPlatformNote />

		{#if overview}
			<div class="overview">
				{#each steps as entry, index (entry.id)}
					<section class="overview-step" aria-labelledby={`${uid}-all-${entry.id}`}>
						<h3 id={`${uid}-all-${entry.id}`}>
							Schritt {index + 1} von {total}: {entry.title}
						</h3>
						<p>{entry.intro}</p>
						{@render links(entry)}
						{@render actionsList(entry)}
						{@render commandBlocks(entry, false)}
						{#if entry.id === 'variable' || entry.id === 'token'}
							<p>Oder über die Systemsteuerung:</p>
							{@render controlPanel()}
						{/if}
						{#if entry.more.length > 0}
							<ul class="more-list">
								{#each entry.more as text (text)}
									<li>{text}</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>
		{:else if step !== undefined}
			{#if warning !== null}
				<SectionMessage tone="warning" compact>
					Schritt {warning.index + 1} ist noch offen: {warning.text}
					{#snippet actions()}
						<button
							class="button-subtle"
							type="button"
							onclick={() => void goTo(warning?.index ?? 0)}
						>
							Zu Schritt {(warning?.index ?? 0) + 1}
						</button>
					{/snippet}
				</SectionMessage>
			{/if}
			<section class="step" aria-labelledby={headingId}>
				<h3 id={headingId} tabindex="-1" bind:this={heading}>
					Schritt {current + 1} von {total}: {step.title}
				</h3>
				<p>{step.intro}</p>
				{@render links(step)}
				{@render actionsList(step)}
				{@render body(step)}
				{#if check !== null}
					<SetupCheck {check}>
						{#snippet actions()}
							{#if step?.id === 'restart' && connection !== null}
								<button class="button-subtle" type="button" onclick={() => void recheck()}>
									Erneut prüfen
								</button>
							{:else if step?.id === 'first-run' && mailbox && connection !== null}
								<button class="button-subtle" type="button" onclick={() => void reload()}>
									Erneut prüfen
								</button>
							{/if}
						{/snippet}
					</SetupCheck>
				{/if}
				{@render more(step)}
			</section>
		{/if}
	</div>

	{#snippet footer({ close })}
		<button class="button-subtle later" type="button" onclick={close}>Später fortsetzen</button>
		{#if current > 0 && !overview}
			<button class="button-secondary" type="button" onclick={() => void goTo(current - 1)}>
				Zurück
			</button>
		{/if}
		{#if last || overview}
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

	/* The stepper stays at the top while the step scrolls (plan §3.7). */
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		gap: 0.5rem;
		padding-bottom: 0.75rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-line);
	}

	.view {
		display: flex;
		justify-content: flex-end;
	}

	.view [aria-pressed='true'] {
		color: var(--color-text);
		border-color: var(--color-line);
	}

	.step,
	.overview,
	.overview-step {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.overview {
		gap: 1.5rem;
	}

	h3 {
		font-size: 1rem;
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
		font-size: 0.875rem;
	}

	.actions,
	.more ul,
	.more-list {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}

	.more summary {
		font-size: 0.875rem;
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.more ul {
		margin-top: 0.5rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* "Später fortsetzen" stands on the left, away from "Zurück" and "Weiter". */
	.later {
		margin-right: auto;
	}
</style>
