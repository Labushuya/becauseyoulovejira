<script lang="ts">
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import { runText, warningText, type BackupFile } from '$lib/domain/backup';
	import type { HostPlatform } from '$lib/domain/host-platform';
	import { formatPointInTime, sizeText } from '$lib/domain/system';
	import { backupDenialNotice, type BackupStore } from '$lib/stores/backup.svelte';
	import BackupPassphrase from './BackupPassphrase.svelte';
	import BackupSettings from './BackupSettings.svelte';

	// Page "Einstellungen → Sicherung" (ADR-0046): the state of the backups, warnings (red only for
	// real errors, ADR-0009), "Jetzt sichern", target folder, passphrase, access data, generations
	// and the backups here and in the target. A server that is not on Windows gets the hint instead
	// (the target, the passphrase and the access data need the scripts of the folder app).
	let { store, platform }: { store: BackupStore; platform: HostPlatform } = $props();

	const uid = $props.id();
	const overview = $derived(store.overview);
	const busy = $derived(store.busy !== null);
	const platformNotice = backupDenialNotice('platform');
	const counts = $derived(
		overview === null
			? ''
			: `${overview.settings.daily} tägliche, ${overview.settings.weekly} wöchentliche, ${overview.settings.monthly} monatliche`
	);
	const sealedText = $derived.by(() => {
		if (overview === null) return '';
		if (overview.settings.target === null) return 'Kein Zielverzeichnis eingestellt';
		const newest = overview.sealed[0];
		return newest === undefined ? 'Noch keine' : runText({ at: newest.at, bytes: newest.bytes });
	});

	function fileText(file: BackupFile): string {
		return `${formatPointInTime(file.at)} · ${sizeText(file.bytes)}`;
	}
</script>

{#if platform !== 'windows'}
	<SectionMessage tone="info" title={platformNotice.title}>{platformNotice.text}</SectionMessage>
{:else if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Sicherung wird geladen …</p>
{:else if overview === null}
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
		Die App sichert einmal am Tag von selbst, solange sie läuft, auch bald nach dem Start, wenn die
		letzte Sicherung älter als einen Tag ist. Die Sicherungen liegen im Ordner
		<code>app\pb_data\backups</code> und, wenn du ein Zielverzeichnis einrichtest, zusätzlich verschlüsselt
		dort.
	</p>

	{#each overview.warnings as warning (warning.code)}
		{@const text = warningText(warning)}
		<SectionMessage tone={warning.tone} title={text.title}>{text.text}</SectionMessage>
	{/each}
	{#if !overview.helper}
		<SectionMessage tone="warning" title="byl-backup.exe fehlt">
			Ohne das Hilfsprogramm entstehen keine verschlüsselten Sicherungen im Zielverzeichnis.
			scripts\build.ps1 baut es in den Ordner app.
		</SectionMessage>
	{/if}

	<section class="part" aria-labelledby={`${uid}-state`}>
		<h3 id={`${uid}-state`}>Zustand</h3>
		<dl class="rows">
			<div class="row">
				<dt>Letzte Sicherung</dt>
				<dd>{runText(overview.last.backup)}</dd>
			</div>
			<div class="row">
				<dt>Im Zielverzeichnis</dt>
				<dd>{sealedText}</dd>
			</div>
			<div class="row">
				<dt>Nächste Sicherung</dt>
				<dd>
					{overview.nextBackupAt === null
						? '–'
						: `etwa ${formatPointInTime(overview.nextBackupAt)}`}
				</dd>
			</div>
			<div class="row">
				<dt>Aufbewahrung</dt>
				<dd>{counts}</dd>
			</div>
		</dl>
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
				class="button-primary"
				type="button"
				aria-disabled={busy}
				aria-busy={store.busy === 'run'}
				aria-describedby={`${uid}-run-hint`}
				onclick={() => {
					if (!busy) void store.runNow();
				}}
			>
				Jetzt sichern
			</button>
			<p class="hint" id={`${uid}-run-hint`}>
				Sichert sofort, etwa vor einem Update, und kopiert die Sicherung verschlüsselt ins
				Zielverzeichnis.
			</p>
		</div>
		<div class="live" role="status">
			{#if store.busy === 'run'}Sicherung läuft …{/if}
		</div>
	</section>

	<BackupSettings {store} {overview} />
	<BackupPassphrase {store} {overview} />

	<section class="part" aria-labelledby={`${uid}-list`}>
		<h3 id={`${uid}-list`}>Sicherungen</h3>
		<h4>Im Ordner app (pb_data\backups)</h4>
		{#if overview.local.length === 0}
			<p class="hint">Noch keine.</p>
		{:else}
			<ul class="files">
				{#each overview.local as file (file.name)}
					<li>
						<span>{fileText(file)}</span>
						<span class="hint">{file.ours ? 'Generation' : 'Andere Sicherung (bleibt)'}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if overview.settings.target !== null}
			<h4>Im Zielverzeichnis (verschlüsselt)</h4>
			{#if overview.target !== null && !overview.target.reachable}
				<p class="hint">Das Zielverzeichnis ist gerade nicht erreichbar.</p>
			{:else if overview.sealed.length === 0}
				<p class="hint">Noch keine.</p>
			{:else}
				<ul class="files">
					{#each overview.sealed as file (file.name)}
						<li><span>{fileText(file)}</span><code class="hint">{file.name}</code></li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/if}

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

	h4 {
		font-size: var(--font-size-body);
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
		flex: 1 1 16rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.action {
		display: grid;
		gap: 0.375rem;
		justify-items: start;
		padding: 0.25rem 0 0.5rem;
	}

	.files {
		display: grid;
		gap: 0.25rem;
		list-style: none;
		font-size: var(--font-size-body);
	}

	.files li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.live {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}
</style>
