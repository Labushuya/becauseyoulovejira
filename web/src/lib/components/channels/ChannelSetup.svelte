<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		CHAT_COMMAND,
		CONTROL_PANEL_STEPS,
		DEFAULT_ALLOWLIST,
		RESTART_FILE,
		chatIdFromHint,
		SETUP_TITLES,
		SETX_WAY_KEY,
		defaultVariable,
		isSetxWay,
		matchesSetupKind,
		openCheckBefore,
		setupProgress,
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
		freeVariableName,
		runResultText,
		settingsDraftOf,
		telegramRepliesAnnouncement,
		type Connection,
		type TelegramRepliesChange
	} from '$lib/domain/connections';
	import { withoutCommands } from '$lib/domain/context';
	import { CREDENTIAL_TEXTS } from '$lib/domain/credentials';
	import { folderPlatformOf } from '$lib/domain/folders';
	import { checkSummary } from '$lib/domain/github';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { checkText } from '$lib/domain/notion';
	import type { ProblemEntry } from '$lib/domain/problems';
	import {
		SECRET_NOT_KEPT,
		SETUP_RESUME_PREFIX,
		isStaleSetupResume,
		parseSetupResume,
		serializeSetupResume,
		setupResumeKey,
		type SetupConnectInputs,
		type SetupResume
	} from '$lib/domain/setup-resume';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { currentNote, restartElsewhere, textForContext } from '$lib/guidance/texts';
	import {
		runProblem as runProblemOf,
		type ConnectionsStore
	} from '$lib/stores/connections.svelte';
	import { appContext } from '$lib/stores/context.svelte';
	import type { CredentialsStore } from '$lib/stores/credentials.svelte';
	import type { GitHubStore } from '$lib/stores/github.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import type { RestartStore } from '$lib/stores/restart.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import HostPlatformNote from '../guidance/HostPlatformNote.svelte';
	import PcOnly from '../guidance/PcOnly.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Stepper from '../guidance/Stepper.svelte';
	import Tabs from '../guidance/Tabs.svelte';
	import Modal from '../overlay/Modal.svelte';
	import RestartAction from '../system/RestartAction.svelte';
	import RestartEmergency from '../system/RestartEmergency.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import CredentialField from './CredentialField.svelte';
	import FolderSetupList from './FolderSetupList.svelte';
	import GitHubSetupRepos from './GitHubSetupRepos.svelte';
	import SecretValueField from './SecretValueField.svelte';
	import SetupCheck from './SetupCheck.svelte';
	import SetupConnectForm from './SetupConnectForm.svelte';
	import TelegramReplySwitches from './TelegramReplySwitches.svelte';

	// Setup assistant (ADR-0026 section 4, plan EH-5 §3.7/§3.8/§3.11): a modal L "‹Dienst›
	// einrichten" with the stepper at the top of the content, one step at a time and the footer
	// "Später fortsetzen", "Zurück" and "Weiter"/"Fertig". The owner keeps kind and connection in the
	// address (?einrichten=<art>&verbindung=<id>), so a reload opens the same setup. The first step
	// shown comes from facts of the server (setupProgress), the step looked at last from
	// sessionStorage (only its number). "Weiter" is never locked; an open check of an earlier step
	// is named at the top of the next one. While the assistant is open it watches its connection
	// through realtime, so a run of the server shows without polling. Nothing is dirty: creating,
	// keywords and the switches of the Telegram answers (last step, ADR-0016 addendum of 2026-10-01)
	// save at once, a typed value is dropped on purpose when the modal closes. Notion
	// (ADR-0041) ends with "Verbindung prüfen"; its result offers "Listen übernehmen …", which closes
	// the assistant and opens the import dialog (no dialog from a dialog). The optional step
	// "Zielprojekt" (ADR-0049) right after "Verbinden" holds the target project of the new entries;
	// it saves at once like the card. GitHub (ADR-0050 §7) creates its connection with the first
	// repository; the same step then lists the repositories and adds more inline, and the assistant
	// ends with "Verbindung prüfen", which asks GitHub for the token, the rate limit and every
	// repository. Folders (ADR-0051 §7) have no variable: the connection comes with its first folder,
	// the same step adds more, and the last one runs the first check ("Jetzt prüfen").
	// Since BW-1 (ADR-0072) the step "Neu starten", "Chat freigeben" of Telegram and the first run of
	// a mailbox restart the app resp. the mail helper in place (RestartAction, the route of the page
	// System), wait for it and check again; the files of the folder app stand only folded under
	// „Notfall“. The tab keeps the step and the inputs of "Verbinden" without secrets in
	// sessionStorage (`byl-setup:<id>`, before the connection `byl-setup:neu:<art>`,
	// domain/setup-resume.ts): a reload opens the same step again, exactly the step a restart was
	// started from. "Später fortsetzen" keeps the entry, "Fertig" and closing otherwise drop it.
	// Since BW-3 (ADR-0075) the steps "Variable setzen", "Token setzen" and "Chat freigeben" set the
	// variables in the browser (CredentialField, `credentials`); setx and the control panel of Windows
	// stand only folded under „Notfall“.
	let {
		kind,
		connectionId,
		store,
		notion,
		github,
		restart = null,
		credentials = null,
		projects = [],
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
		/** GitHub: "Verbindung prüfen" of the last step. */
		github: GitHubStore;
		/** "Jetzt neu starten" in the steps (BW-1); without it only the emergency way stands. */
		restart?: RestartStore | null;
		/** Setting the variables in the browser (BW-3); without it only setx stands, not folded. */
		credentials?: CredentialsStore | null;
		/** Every project of the catalog, archived ones included (the step "Zielprojekt"). */
		projects?: readonly ProjectRef[];
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
	/** The failed question for the variables, with "Details" (FP-1, since BW-1). */
	const statusFailure = $derived(connection === null ? null : store.statusFailure(connection.id));
	/**
	 * Before the connection exists, a name no connection uses yet, so `setx` for a second one does
	 * not overwrite the secret of the first (ADR-0041, addendum of 2026-10-01).
	 */
	const variable = $derived(
		connection?.secretEnv ??
			freeVariableName(
				defaultVariable(kind),
				store.connections.map((item) => item.secretEnv)
			)
	);
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
	/** Folders: no variables; a run is a check of the folders. */
	const folders = $derived(kind === 'ordner');

	/**
	 * The note instead of a step that works only at the machine of the app (KOB-1, ADR-0057): the
	 * variable with setx or the control panel there; for the restart who does it where (BW-1).
	 * Paragraphs, [] while the context loads, null where the step shows. Read in the template, it
	 * follows the context of the tab.
	 */
	function stepNote(entry: SetupStep): readonly string[] | null {
		if (entry.id === 'restart') return restartElsewhere('restart');
		if (entry.id === 'variable' || entry.id === 'token') {
			const note = currentNote('pc');
			return note === null ? null : note === '' ? [] : [note];
		}
		return null;
	}
	const host = findHostStore();
	const platform = $derived(folderPlatformOf(host?.platform ?? DEFAULT_HOST_PLATFORM));

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

	/**
	 * The entry of this tab under `key` (domain/setup-resume.ts); a broken or expired one goes. A
	 * blocked storage only loses the way back; the progress still comes from the server.
	 */
	function readResume(key: string): SetupResume | null {
		try {
			const storage = session();
			const stored = storage?.getItem(key) ?? null;
			const entry = parseSetupResume(stored, Date.now());
			if (stored !== null && entry === null) storage?.removeItem(key);
			return entry;
		} catch {
			return null;
		}
	}

	/** Drops the broken and expired entries of every assistant of this tab. */
	function pruneResumes() {
		try {
			const storage = session();
			if (storage === null) return;
			const now = Date.now();
			const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
			for (const key of keys) {
				if (key?.startsWith(SETUP_RESUME_PREFIX) && isStaleSetupResume(storage.getItem(key), now)) {
					storage.removeItem(key);
				}
			}
		} catch {
			// Nothing to tidy where the storage is blocked.
		}
	}

	function dropResume(key: string) {
		try {
			session()?.removeItem(key);
		} catch {
			// Blocked storage: there is nothing to drop.
		}
	}

	/** Key of the entry now: of the connection of the address, or before it exists of the kind. */
	const resumeKey = $derived(setupResumeKey(kind, connectionId));

	// The entry of this tab when the assistant opens (after a reload, a restart or "Später
	// fortsetzen"), read once; stale entries of other assistants go first.
	const resumed = untrack(() => {
		pruneResumes();
		return readResume(setupResumeKey(kind, connectionId));
	});
	/** The inputs of "Verbinden" in this tab; restored when the assistant opens. */
	let connectInputs = $state.raw<SetupConnectInputs | null>(resumed?.connect ?? null);
	/** A restart was started here or the tab came back: values of "Wert hier einsetzen" are gone. */
	let valuesGone = $state(resumed !== null);

	/**
	 * Keeps the step (and before the connection its inputs) under `key`; `restarting` marks the step
	 * a restart was started from.
	 */
	function remember(index: number, restarting = false, key = resumeKey) {
		try {
			session()?.setItem(
				key,
				serializeSetupResume({
					step: index,
					savedAt: Date.now(),
					restart: restarting,
					connect: key === setupResumeKey(kind, null) ? connectInputs : null
				})
			);
		} catch {
			// Only the way back to the step is lost; the progress still comes from the server.
		}
	}

	/** The form "Verbinden" changed: its inputs without secrets go into the entry of this tab. */
	function rememberInputs(inputs: SetupConnectInputs) {
		connectInputs = inputs;
		remember(current);
	}

	/** "Später fortsetzen" keeps the entry; "Fertig", ×, Esc and the veil end the setup and drop it. */
	let keepForLater = false;

	function closeAssistant() {
		if (keepForLater) {
			remember(current);
		} else {
			dropResume(resumeKey);
			dropResume(setupResumeKey(kind, null));
		}
		onclose();
	}

	/**
	 * First step: the step a restart was started from; else the first open one after the facts, or
	 * a later one looked at in this tab.
	 */
	const initial = $derived(
		Math.min(
			resumed?.restart === true
				? resumed.step
				: Math.max(setupProgress(kind, facts), resumed?.step ?? 0),
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
	const currentStepNote = $derived(step === undefined ? null : stepNote(step));
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

	// The steps that set a variable read its state in the user environment (BW-3), also of the
	// suggested name before the connection exists; only the administrator at the PC may.
	const settingStep = $derived(stepId === 'variable' || stepId === 'token' || stepId === 'chat');
	$effect(() => {
		const names = kind === 'telegram' ? [variable, allowlist] : [variable];
		if (credentials === null || !settingStep || !appContext.capabilities.scripts) return;
		const current = credentials;
		untrack(() => void current.load(names));
	});

	// Realtime on exactly this connection while the assistant is open (plan §3.8, no polling).
	$effect(() => {
		const id = watchedId;
		if (id === null) return;
		return untrack(() => store.watch(id));
	});

	function created(next: Connection) {
		hold();
		// The entry moves from the kind to the new connection; its inputs are done.
		dropResume(setupResumeKey(kind, null));
		connectInputs = null;
		remember(current, false, setupResumeKey(kind, next.id));
		onconnection(next.id);
	}

	// A connection that is gone takes its entry along.
	$effect(() => {
		if (missing) untrack(() => dropResume(setupResumeKey(kind, connectionId)));
	});

	/** Place of a restart in this assistant: the RestartStore shows its run and result only there. */
	function restartPlace(stepId: SetupStep['id']): string {
		return `setup:${kind}:${connectionId ?? 'neu'}:${stepId}`;
	}

	/** A restart begins at this step: it stays, and a reload opens exactly here again. */
	function beforeRestart() {
		hold();
		remember(current, true);
	}

	/** The server is back: ask it again whether it sees the variables. */
	function afterRestart() {
		valuesGone = true;
		if (connection !== null) void store.checkStatus(connection.id);
	}

	/** What the variable of a step holds, from the placeholder of its command (e.g. "Bot-Token"). */
	function secretLabelOf(entry: SetupStep): string {
		const command = entry.commands.find((item) => item.value !== undefined);
		const placeholder =
			command?.value === undefined ? undefined : command.placeholders[command.value];
		return placeholder?.label ?? 'Wert';
	}

	/** Steps with "Wert hier einsetzen" for a secret: after a reload or a restart its value is gone. */
	function takesSecret(entry: SetupStep): boolean {
		return entry.commands.some(
			(command) =>
				command.value !== undefined && command.placeholders[command.value]?.secret === true
		);
	}

	/** Saves the keywords; a failed request comes back with its entry for "Details" (FP-1). */
	async function saveKeywords(
		keywords: string[],
		announcement: string
	): Promise<string | { message: string; problem: ProblemEntry | null } | null> {
		if (connection === null) return null;
		hold();
		const result = await store.saveSettings(
			connection.id,
			{ ...settingsDraftOf(connection), keywords },
			announcement
		);
		if (result.ok) return null;
		if (result.message !== null)
			return { message: result.message, problem: result.problem ?? null };
		return Object.values(result.fields)[0] ?? 'Die Stichwörter ließen sich nicht speichern.';
	}

	/** Telegram: error of the last switch of the answers in the chat (inline). */
	let repliesError = $state<string | null>(null);
	/** The failed request behind `repliesError`, for "Details" (FP-1, ADR-0071). */
	let repliesProblem = $state.raw<ProblemEntry | null>(null);

	async function saveReplies(change: TelegramRepliesChange) {
		if (connection === null) return;
		hold();
		repliesError = null;
		const result = await store.saveSettings(
			connection.id,
			{ ...settingsDraftOf(connection), ...change },
			telegramRepliesAnnouncement(connection.label, change)
		);
		if (!result.ok) {
			repliesError =
				result.message ??
				Object.values(result.fields)[0] ??
				'Die Einstellung ließ sich nicht speichern.';
			repliesProblem = result.problem ?? null;
		}
	}

	let runError = $state<string | null>(null);
	let runProblem = $state.raw<ProblemEntry | null>(null);
	const lastRun = $derived(connection === null ? null : store.lastRun(connection.id));
	const running = $derived(connection !== null && store.isRunning(connection.id));

	async function runNow() {
		if (connection === null) return;
		hold();
		runError = null;
		const result = await store.runNow(connection.id, { announce: false });
		if (!result.ok && result.message !== null) {
			runError = result.message;
			runProblem = result.problem ?? null;
		}
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

	/**
	 * Result of "Hilfsprozess prüfen": only on a click, the helper logs in to the mailbox. A failure
	 * carries its entry for "Details" (FP-1, since BW-1).
	 */
	let helper = $state.raw<
		'ok' | 'unavailable' | { message: string; hint: string; problem: ProblemEntry | null } | null
	>(null);
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
					: { message: outcome.message, hint: outcome.hint, problem: outcome.problem };
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

	/** GitHub: answer of "Verbindung prüfen" on this page, null before the first. */
	const githubCheck = $derived(connection === null ? null : github.lastCheck(connection.id));
	const githubChecking = $derived(connection !== null && github.isChecking(connection.id));
	const githubSummary = $derived(
		githubCheck === null
			? null
			: githubCheck.kind === 'ok'
				? checkSummary(githubCheck.check)
				: { tone: 'error' as const, text: githubCheck.message }
	);

	async function checkGitHub() {
		if (connection === null) return;
		hold();
		await github.check(connection.id, connection.label, { announce: false });
		await store.refresh(connection.id);
	}

	/** Checking and its answer, per kind (Notion or GitHub). */
	const checkingNow = $derived(kind === 'github' ? githubChecking : notionChecking);
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
				<li>{textForContext(action)}</li>
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

{#snippet chatCommand(id: string)}
	<CodeBlock
		code={CHAT_COMMAND.template}
		label={CHAT_COMMAND.label}
		placeholders={CHAT_COMMAND.placeholders}
		values={{ ...fixedValues, ids: id }}
	/>
	<SecretValueField
		label="Befehl für mehrere IDs"
		template={CHAT_COMMAND.template}
		placeholders={CHAT_COMMAND.placeholders}
		name="ids"
		fixed={fixedValues}
	/>
{/snippet}

{#snippet windowsWay(entry: SetupStep)}
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
				{#if folders}
					{running ? 'Wird geprüft …' : 'Jetzt prüfen'}
				{:else}
					{running ? 'Wird abgerufen …' : 'Jetzt abrufen'}
				{/if}
			</button>
		</div>
		{#if lastRun !== null}
			<SectionMessage
				tone={lastRun.status === 'ok' ? 'success' : lastRun.status === 'error' ? 'error' : 'info'}
				title={lastRun.status === 'ok' ? (folders ? 'Geprüft' : 'Abgerufen') : undefined}
				compact={lastRun.status !== 'ok'}
				live
				headingLevel={4}
				problem={runProblemOf(connection.id, lastRun)}
			>
				{textForContext(runResultText(connection.label, lastRun))}
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
			<SectionMessage tone="error" compact live problem={runProblem}>
				{textForContext(runError)}
			</SectionMessage>
		{/if}
	{/if}
{/snippet}

{#snippet body(entry: SetupStep)}
	{#if entry.id === 'connect'}
		{#if connection === null}
			<SetupConnectForm
				{kind}
				{store}
				restored={connectInputs}
				oncreated={created}
				onremember={rememberInputs}
			/>
		{:else if kind === 'github'}
			{@const current = connection}
			<GitHubSetupRepos
				connection={current}
				{github}
				onsave={(settings, announcement) => {
					hold();
					return store.saveGitHub(current.id, settings, announcement);
				}}
			/>
		{:else if folders}
			{@const current = connection}
			<FolderSetupList
				connection={current}
				{platform}
				onsave={(settings, announcement) => {
					hold();
					return store.saveFolders(current.id, settings, announcement);
				}}
			/>
		{:else if mailbox}
			<KeywordEditor
				keywords={connection.keywords}
				name={connection.label}
				description={KEYWORD_SEARCH_TEXT[connection.type]}
				emptyText={NO_KEYWORDS_WARNING}
				onsave={saveKeywords}
			/>
		{/if}
	{:else if entry.id === 'target'}
		{#if connection !== null}
			{@const current = connection}
			<CardTargetProject
				id={`${uid}-target`}
				name={current.label}
				entries="Neue Einträge dieser Verbindung"
				value={current.targetProjectId ?? null}
				{projects}
				ready={current.targetReady !== false}
				onsave={(project) => {
					hold();
					return store.setTarget(current.id, project);
				}}
			/>
		{:else}
			<p class="hint">Erst die Verbindung anlegen; danach wählst du hier ihr Zielprojekt.</p>
		{/if}
	{:else if entry.id === 'variable' || entry.id === 'token'}
		{#if valuesGone && takesSecret(entry)}
			<SectionMessage tone="info" compact>{SECRET_NOT_KEPT}</SectionMessage>
		{/if}
		{#if credentials !== null}
			<!-- BW-3: the variable is set here in the browser; Windows is the emergency way. -->
			<CredentialField
				name={variable}
				label={secretLabelOf(entry)}
				store={credentials}
				{restart}
				place={`${restartPlace(entry.id)}:${variable}`}
				onrestart={beforeRestart}
				onrestarted={afterRestart}
			/>
			{#if entry.id === 'token'}
				<CredentialField
					name={allowlist}
					label="Erlaubte Chat- oder User-IDs"
					hint="Zum Start 0 setzen; die richtige ID zeigt die App im Schritt „Chat freigeben“."
					store={credentials}
					{restart}
					place={`${restartPlace(entry.id)}:${allowlist}`}
					onrestart={beforeRestart}
					onrestarted={afterRestart}
				/>
			{/if}
			<details class="emergency">
				<summary>{CREDENTIAL_TEXTS.setupEmergencySummary}</summary>
				<div class="emergency-body">{@render windowsWay(entry)}</div>
			</details>
		{:else}
			{@render windowsWay(entry)}
		{/if}
	{:else if entry.id === 'restart'}
		{#if connection !== null && facts.secretStatus !== null && check?.tone === 'open'}
			<SectionMessage tone="warning" compact>
				{#if credentials !== null}
					Hast du die Variable schon gesetzt? Dann starte die App jetzt neu; danach prüft dieser
					Schritt von selbst erneut.
				{:else}
					Hast du setx schon ausgeführt? Dann starte die App jetzt neu; danach prüft dieser Schritt
					von selbst erneut.
				{/if}
			</SectionMessage>
		{/if}
		{#if statusFailure !== null}
			<SectionMessage tone="error" compact live problem={statusFailure.problem}>
				{textForContext(statusFailure.message)}
			</SectionMessage>
		{/if}
		<RestartAction
			store={restart}
			place={restartPlace('restart')}
			hint={kind === 'github'
				? 'Startet becauseyoulovejira geordnet neu, wie auf der Seite „System“. Ob die App das Token sieht, zeigt danach der letzte Schritt.'
				: 'Startet becauseyoulovejira geordnet neu, wie auf der Seite „System“. Danach prüft dieser Schritt erneut, ob die App die Variable sieht.'}
			onstart={beforeRestart}
			onrestarted={afterRestart}
		>
			{#snippet emergency()}
				{@render commandBlocks(entry, false)}
			{/snippet}
		</RestartAction>
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
					Der Mail-Hilfsprozess läuft nicht. Er startet, sobald eine eingeschaltete
					Postfach-Verbindung besteht und die App die Variable sieht.
				</SectionMessage>
				<RestartAction
					store={restart}
					task="mail-restart"
					place={restartPlace('first-run')}
					hint="Beendet den Mail-Hilfsprozess geordnet und startet ihn wieder; danach prüft dieser Schritt ihn erneut."
					onstart={hold}
					onrestarted={() => void probe()}
				/>
			{:else if helper !== null}
				<SectionMessage tone="error" live problem={helper.problem}>
					{textForContext(`${helper.message} ${helper.hint}`)}
				</SectionMessage>
			{/if}
		{/if}
	{:else if entry.id === 'chat'}
		{@render runBlock()}
		{#if chatId !== null}
			<!-- The ID goes into a variable with setx and needs a restart: at the PC only (KOB-1). -->
			<PcOnly need="pc">
				{#if credentials !== null}
					<SectionMessage tone="info" title={`Erkannte Chat-ID: ${chatId}`} live headingLevel={4}>
						Gib diese ID frei: unten bei {allowlist} „Setzen …“ oder „Ersetzen …“ wählen, die ID eintragen,
						dann die App neu starten und danach erneut „Jetzt abrufen“.
					</SectionMessage>
					<CredentialField
						name={allowlist}
						label="Erlaubte Chat- oder User-IDs"
						hint={`Die erkannte ID ist ${chatId}. Ersetzen überschreibt die ganze Liste – gib alle IDs an, die erlaubt bleiben sollen (mit Komma getrennt).`}
						store={credentials}
						{restart}
						place={`${restartPlace('chat')}:${allowlist}`}
						onrestart={beforeRestart}
						onrestarted={afterRestart}
					/>
					<details class="emergency">
						<summary>{CREDENTIAL_TEXTS.setupEmergencySummary}</summary>
						<div class="emergency-body">{@render chatCommand(chatId)}</div>
					</details>
				{:else}
					<SectionMessage tone="info" title={`Erkannte Chat-ID: ${chatId}`} live headingLevel={4}>
						Gib diese ID frei: den Befehl ausführen, dann unten „Jetzt neu starten“ und danach
						erneut „Jetzt abrufen“.
					</SectionMessage>
					{@render chatCommand(chatId)}
				{/if}
				<RestartAction
					store={restart}
					place={restartPlace('chat')}
					hint="Startet becauseyoulovejira geordnet neu, damit die App die freigegebene ID kennt. Danach erneut „Jetzt abrufen“."
					onstart={beforeRestart}
					onrestarted={afterRestart}
				>
					{#snippet emergency()}
						<CodeBlock
							code={RESTART_FILE.template}
							label={RESTART_FILE.label}
							placeholders={RESTART_FILE.placeholders}
							copyable={RESTART_FILE.copyable}
						/>
					{/snippet}
				</RestartAction>
			</PcOnly>
		{/if}
	{:else if entry.id === 'check'}
		{#if connection !== null}
			<div>
				<button
					class="button-secondary"
					type="button"
					aria-busy={checkingNow}
					aria-disabled={checkingNow}
					onclick={() => void (kind === 'github' ? checkGitHub() : checkNotion())}
				>
					{checkingNow ? 'Wird geprüft …' : 'Verbindung prüfen'}
				</button>
			</div>
			{#if kind === 'github'}
				{#if githubSummary !== null}
					<SectionMessage
						tone={githubSummary.tone}
						title={githubSummary.tone === 'success' ? 'Verbindung steht' : undefined}
						compact={githubSummary.tone !== 'success'}
						live
						headingLevel={4}
					>
						{textForContext(githubSummary.text)}
					</SectionMessage>
				{/if}
				{#if githubCheck?.kind === 'ok' && githubCheck.check.repos.length > 0}
					<ul class="checked-repos" aria-label="Repositorys">
						{#each githubCheck.check.repos as repo (repo.repo)}
							<li class:failed={!repo.ok}>
								{#if !repo.ok}<ErrorIcon />{/if}
								<span>
									{repo.name}{repo.ok
										? repo.private
											? ': erreichbar (privat)'
											: ': erreichbar'
										: `: ${repo.message}`}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if notionCheck !== null}
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
										if (connection === null) return;
										// The setup is done: its entry of this tab goes (BW-1).
										dropResume(resumeKey);
										onimport(connection);
									}}
								>
									Listen übernehmen …
								</button>
							{/if}
						{/snippet}
					</SectionMessage>
				{:else}
					<SectionMessage tone={notionCheck.kind === 'error' ? 'error' : 'info'} live>
						<!-- Missing access data lead to the step "Neu starten" with its button (BW-1). -->
						{notionCheck.kind === 'missing' && stepIndex('restart') >= 0
							? withoutCommands(notionCheck.message).text
							: textForContext(notionCheck.message)}
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
			<TelegramReplySwitches {connection} onchange={saveReplies} />
			{#if repliesError !== null}
				<SectionMessage tone="error" compact live problem={repliesProblem}>
					{repliesError}
				</SectionMessage>
			{/if}
		{/if}
		{@render runBlock()}
	{/if}
{/snippet}

{#snippet noteMessage(note: readonly string[])}
	<SectionMessage tone="info" compact>
		{#each note as text (text)}<span class="note-line">{text}</span>{/each}
	</SectionMessage>
{/snippet}

{#snippet more(entry: SetupStep)}
	{#if entry.more.length > 0}
		<details class="more">
			<summary>Mehr dazu</summary>
			<ul>
				{#each entry.more as text (text)}
					<li>{textForContext(text)}</li>
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
	onclose={closeAssistant}
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
		{#if !folders}
			<HostPlatformNote />
		{/if}

		{#if overview}
			<div class="overview">
				{#each steps as entry, index (entry.id)}
					{@const note = stepNote(entry)}
					<section class="overview-step" aria-labelledby={`${uid}-all-${entry.id}`}>
						<h3 id={`${uid}-all-${entry.id}`}>
							Schritt {index + 1} von {total}: {entry.title}
						</h3>
						{#if note === null}
							<p>{textForContext(entry.intro)}</p>
							{@render links(entry)}
							{@render actionsList(entry)}
							{#if entry.id === 'restart'}
								<!-- The file of the restart is the emergency way, folded (BW-1). -->
								<RestartEmergency>{@render commandBlocks(entry, false)}</RestartEmergency>
							{:else}
								{@render commandBlocks(entry, false)}
							{/if}
							{#if entry.id === 'variable' || entry.id === 'token'}
								<p>Oder über die Systemsteuerung:</p>
								{@render controlPanel()}
							{/if}
							{#if entry.more.length > 0}
								<ul class="more-list">
									{#each entry.more as text (text)}
										<li>{textForContext(text)}</li>
									{/each}
								</ul>
							{/if}
						{:else if note.length > 0}
							{@render noteMessage(note)}
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
				{#if currentStepNote === null}
					<p>{textForContext(step.intro)}</p>
					{@render links(step)}
					{@render actionsList(step)}
					{@render body(step)}
				{:else if currentStepNote.length > 0}
					{@render noteMessage(currentStepNote)}
				{/if}
				{#if check !== null}
					<SetupCheck check={{ ...check, text: textForContext(check.text) }}>
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
				{#if currentStepNote === null}
					{@render more(step)}
				{/if}
			</section>
		{/if}
	</div>

	{#snippet footer({ close })}
		<button
			class="button-subtle later"
			type="button"
			onclick={() => {
				keepForLater = true;
				close();
			}}
		>
			Später fortsetzen
		</button>
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

	/* The way through Windows below the field of the browser (BW-3), like „Notfall“ of BW-1. */
	.emergency summary {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.emergency-body {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin-top: 0.5rem;
	}

	.more ul {
		margin-top: 0.5rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* One paragraph of a note in place of a step (BW-1). */
	.note-line {
		display: block;
	}

	.checked-repos {
		display: grid;
		gap: 0.25rem;
		padding: 0;
		list-style: none;
	}

	.checked-repos li {
		display: flex;
		gap: 0.25rem;
		align-items: flex-start;
		overflow-wrap: anywhere;
	}

	.checked-repos li.failed {
		color: var(--color-danger);
	}

	/* "Später fortsetzen" stands on the left, away from "Zurück" and "Weiter". */
	.later {
		margin-right: auto;
	}
</style>
