<script lang="ts">
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import type { HostPlatform } from '$lib/domain/host-platform';
	import {
		AUTOSTART_TEXTS,
		DENIAL_TEXTS,
		RESTART_REASON_LABELS,
		RESTART_TEXTS,
		backgroundRunText,
		groupOtherServers,
		mailText,
		otherServerText,
		restartNeeded,
		stateText,
		testInstancesText,
		verdictText
	} from '$lib/domain/system';
	import type { SystemStore } from '$lib/stores/system.svelte';
	import ScriptProblemDetails from './ScriptProblemDetails.svelte';
	import SystemDoctor from './SystemDoctor.svelte';
	import SystemLogs from './SystemLogs.svelte';

	// Page "Einstellungen → System" (ADR-0043): the state of the app on this machine and the fixed
	// actions of the control script, without "Beenden". The .bat files in the folder app keep
	// working; this page only adds a way from the dashboard. A server that is not on Windows gets
	// the hint instead (the scripts are for Windows, the platforms are deferred). Actions wait for
	// each other; their buttons stay focusable (aria-disabled), so the focus stays where it was. An
	// error of the last run without window (autostart, restart or restore from the app) stands above
	// the state with its entry of the catalog of the scripts (ADR-0048 §4), as a warning: the app
	// runs again by now, the error is one of the past run.
	let { store, platform }: { store: SystemStore; platform: HostPlatform } = $props();

	const uid = $props.id();
	let confirming = $state(false);

	const overview = $derived(store.overview);
	const status = $derived(overview?.status ?? null);
	const busy = $derived(store.busy !== null);
	const restarting = $derived(
		store.restartPhase === 'stopping' || store.restartPhase === 'starting'
	);
	const needed = $derived(status !== null && restartNeeded(status));
	const mail = $derived(overview === null ? null : mailText(overview));
	// Another installation stays visible; test instances (worktrees, copies of the tests) are folded
	// into "N Test-Instanzen (Entwicklung)" (plan robuste-skripte RS-4).
	const others = $derived(groupOtherServers(status?.otherServers ?? []));
	const restartHint = $derived.by(() => {
		if (status === null) return '';
		if (status.state === 'unhealthy') return 'Nötig: Der Server antwortet nicht.';
		if (status.verdict === 'restart') {
			const reasons = status.restartReasons.map((reason) => RESTART_REASON_LABELS[reason]);
			return reasons.length === 0 ? 'Nötig.' : `Nötig: ${reasons.join(', ')}.`;
		}
		return 'Zurzeit nicht nötig. Anders als neu-starten.bat startet dieser Knopf immer neu.';
	});

	function run(action: () => Promise<void>) {
		if (!busy) void action();
	}

	function askRestart() {
		if (!busy) confirming = true;
	}

	function confirmRestart() {
		confirming = false;
		void store.restart();
	}

	function toggleAutostart(event: Event & { currentTarget: HTMLInputElement }) {
		void store.setAutostart(event.currentTarget.checked);
	}

	function guardSwitch(event: MouseEvent) {
		if (busy) event.preventDefault();
	}
</script>

{#if platform !== 'windows'}
	<SectionMessage tone="info" title={DENIAL_TEXTS.platform.title}>
		{DENIAL_TEXTS.platform.text}
	</SectionMessage>
{:else if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Zustand wird geladen …</p>
{:else if status === null || overview === null || mail === null}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.load()}>
					Erneut laden
				</button>
			{/snippet}
		</SectionMessage>
	{/if}
{:else}
	<p class="intro">
		Hier bedienst du becauseyoulovejira auf diesem Rechner. Die Dateien im Ordner <code>app</code>
		(start.bat, neu-starten.bat, status.bat …) funktionieren weiter wie bisher.
	</p>

	<div class="live" role="status">
		{#if restarting}
			<SectionMessage tone="info" title={RESTART_TEXTS.runningTitle}>
				{store.restartPhase === 'stopping' ? RESTART_TEXTS.stopping : RESTART_TEXTS.starting}
				Diese Seite verbindet sich danach von selbst neu.
			</SectionMessage>
		{/if}
	</div>
	{#if store.restartPhase === 'failed'}
		<SectionMessage tone="error" live title={RESTART_TEXTS.failedTitle}>
			{RESTART_TEXTS.failed}
		</SectionMessage>
	{:else if store.restartPhase === 'not-started'}
		<SectionMessage tone="error" live title={RESTART_TEXTS.notStartedTitle}>
			{RESTART_TEXTS.notStarted}
		</SectionMessage>
	{/if}
	{#if status.backgroundProblem !== null}
		<SectionMessage tone="warning" title="Problem beim letzten Lauf ohne Fenster">
			<p>
				{backgroundRunText(status.backgroundProblem)}: {status.backgroundProblem.report.problem}
			</p>
			<ScriptProblemDetails report={status.backgroundProblem.report} />
			<p class="hint">
				Der Hinweis verschwindet, sobald becauseyoulovejira wieder ohne Fehler startet oder du
				status.bat im Ordner <code>app</code> ausführst.
			</p>
		</SectionMessage>
	{/if}

	<section class="part" aria-labelledby={`${uid}-state`}>
		<h3 id={`${uid}-state`}>Zustand</h3>
		<dl class="rows">
			<div class="row">
				<dt>Server</dt>
				<dd>{stateText(status)}</dd>
			</div>
			<div class="row">
				<dt>Adresse</dt>
				<dd>
					<code>{status.url}</code>
					{#if status.configuredPort !== status.port}
						<span class="hint"
							>Eingestellt ist Port {status.configuredPort}; er gilt nach dem Neustart.</span
						>
					{/if}
				</dd>
			</div>
			<div class="row">
				<dt>Stand</dt>
				<dd>{verdictText(status)}</dd>
			</div>
			<div class="row">
				<dt>Mail-Helfer</dt>
				<dd>
					{mail.label}
					{#if mail.hint !== ''}<span class="hint">{mail.hint}</span>{/if}
				</dd>
			</div>
			<div class="row">
				<dt>Autostart</dt>
				<dd>{AUTOSTART_TEXTS[status.autostart]}</dd>
			</div>
			{#if status.otherServers.length > 0}
				<div class="row">
					<dt>Andere Kopien</dt>
					<dd>
						{#if others.copies.length > 0}
							<ul class="others">
								{#each others.copies as server, index (`${server.pid}-${index}`)}
									<li>{otherServerText(server)}</li>
								{/each}
							</ul>
						{/if}
						{#if others.tests.length > 0}
							<details class="tests">
								<summary>{testInstancesText(others.tests.length)}</summary>
								<ul class="others">
									{#each others.tests as server, index (`${server.pid}-${index}`)}
										<li>{otherServerText(server)}</li>
									{/each}
								</ul>
							</details>
						{/if}
						<span class="hint">Nur ein Hinweis; sie bleiben unberührt.</span>
					</dd>
				</div>
			{/if}
		</dl>
		<details class="details">
			<summary>Technische Angaben</summary>
			<dl class="rows">
				<div class="row">
					<dt>Prozess-ID (PID)</dt>
					<dd>{status.pid ?? '–'}</dd>
				</div>
				<div class="row">
					<dt>PID des Mail-Helfers</dt>
					<dd>{status.mailHelperPid ?? '–'}</dd>
				</div>
				<div class="row">
					<dt>Ordner</dt>
					<dd><code>{overview.appDir}</code></dd>
				</div>
			</dl>
		</details>
	</section>

	<section class="part" aria-labelledby={`${uid}-actions`}>
		<h3 id={`${uid}-actions`}>Aktionen</h3>
		{#if store.actionMessage !== null}
			<SectionMessage
				tone={store.actionMessage.tone}
				live
				title={store.actionMessage.message.title}
			>
				{store.actionMessage.message.text}
			</SectionMessage>
		{/if}
		<div class="action">
			<button
				class={needed ? 'button-primary' : 'button-secondary'}
				type="button"
				aria-disabled={busy}
				aria-busy={store.busy === 'restart'}
				aria-describedby={`${uid}-restart-hint`}
				onclick={askRestart}
			>
				Jetzt neu starten
			</button>
			<p class="hint" id={`${uid}-restart-hint`}>{restartHint}</p>
		</div>
		<div class="action">
			<button
				class="button-secondary"
				type="button"
				aria-disabled={busy}
				aria-busy={store.busy === 'mail-restart'}
				aria-describedby={`${uid}-mail-hint`}
				onclick={() => run(() => store.restartMail())}
			>
				Mail-Helfer neu starten
			</button>
			<p class="hint" id={`${uid}-mail-hint`}>
				Beendet den Mail-Hilfsprozess geordnet und startet ihn wieder, wenn ein Postfach
				eingeschaltet ist.
			</p>
		</div>
		<div class="action">
			<label class="setting">
				<span class="setting-name">Beim Anmelden an Windows starten</span>
				<input
					type="checkbox"
					role="switch"
					checked={status.autostart === 'on'}
					aria-disabled={busy}
					aria-busy={store.busy === 'autostart-on' || store.busy === 'autostart-off'}
					aria-describedby={`${uid}-autostart-hint`}
					onclick={guardSwitch}
					onchange={toggleAutostart}
				/>
			</label>
			<p class="hint" id={`${uid}-autostart-hint`}>
				Startet die App ohne Fenster, sobald du dich an Windows anmeldest (wie autostart-an.bat).
			</p>
			{#if status.autostart === 'other'}
				<SectionMessage tone="warning" compact>
					Der Autostart zeigt auf einen anderen Ordner. Einschalten stellt ihn auf diesen Ordner um.
				</SectionMessage>
			{/if}
		</div>
	</section>

	<section class="part" aria-labelledby={`${uid}-doctor`}>
		<h3 id={`${uid}-doctor`}>Umgebung prüfen</h3>
		<p class="hint">
			Prüft Dateien, Port, Schreibrechte, Plattenplatz, andere Kopien und den Autostart.
		</p>
		<div>
			<button
				class="button-secondary"
				type="button"
				aria-busy={store.doctor.state === 'loading'}
				aria-disabled={store.doctor.state === 'loading'}
				onclick={() => {
					if (store.doctor.state !== 'loading') void store.runDoctor();
				}}
			>
				Umgebung prüfen
			</button>
		</div>
		<SystemDoctor part={store.doctor} />
	</section>

	<section class="part" aria-labelledby={`${uid}-logs`}>
		<h3 id={`${uid}-logs`}>Logs</h3>
		<p class="hint">
			Die letzten 200 Zeilen je Datei aus <code>app\logs</code>, ohne Zugangsdaten, E-Mail-Adressen
			und Pfade von Adressen.
		</p>
		<SystemLogs part={store.logs} onload={() => void store.loadLogs()} />
	</section>
{/if}

<ConfirmDialog
	open={confirming}
	title={RESTART_TEXTS.confirmTitle}
	confirmLabel={RESTART_TEXTS.confirmLabel}
	onconfirm={confirmRestart}
	oncancel={() => (confirming = false)}
>
	<p>{RESTART_TEXTS.confirm}</p>
	<p>{RESTART_TEXTS.unsaved}</p>
</ConfirmDialog>

<style>
	.intro,
	.note,
	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.part {
		display: grid;
		gap: 0.625rem;
		margin-top: 1rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.rows {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		flex: 0 0 10rem;
		color: var(--color-text-muted);
	}

	dd {
		display: grid;
		flex: 1 1 16rem;
		gap: 0.125rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.others {
		display: grid;
		gap: 0.125rem;
		list-style: none;
	}

	.tests summary {
		cursor: pointer;
	}

	.tests[open] summary {
		margin-bottom: 0.25rem;
	}

	.details summary {
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.details .rows {
		margin-top: 0.5rem;
	}

	.action {
		display: grid;
		gap: 0.375rem;
		justify-items: start;
		padding: 0.25rem 0 0.5rem;
	}

	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		width: min(28rem, 100%);
		cursor: pointer;
	}

	.setting-name {
		font-size: var(--font-size-body);
		font-weight: 500;
	}
</style>
