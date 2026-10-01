<script lang="ts">
	import { resolve } from '$app/paths';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		newestToVerify,
		RESTORE_PROGRESS_TEXTS,
		restoreText,
		runText,
		verifyText,
		warningText
	} from '$lib/domain/backup';
	import type { HostPlatform } from '$lib/domain/host-platform';
	import { formatPointInTime } from '$lib/domain/system';
	import { helpHref } from '$lib/settings-sections';
	import { backupDenialNotice, type BackupStore } from '$lib/stores/backup.svelte';
	import BackupList from './BackupList.svelte';
	import BackupPassphrase from './BackupPassphrase.svelte';
	import BackupSettings from './BackupSettings.svelte';

	// Page "Einstellungen → Sicherung" (ADR-0046): the state of the backups, their last check and the
	// last restore, warnings (red only for real errors, ADR-0009), a running restore, "Jetzt
	// sichern", "Jetzt prüfen", target folder, passphrase, access data, generations, the backups here
	// and in the target and the safety copies. A server that is not on Windows gets the hint instead
	// (the target, the passphrase and the access data need the scripts of the folder app).
	let { store, platform }: { store: BackupStore; platform: HostPlatform } = $props();

	const uid = $props.id();
	const overview = $derived(store.overview);
	const busy = $derived(store.busy !== null);
	const newest = $derived(overview === null ? null : newestToVerify(overview));
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
	<p class="intro">
		Für den Notfall: die <a href={resolve('/notfallkarte')}>Notfallkarte</a> drucken und neben die
		Platte legen; die Schritte für einen neuen Rechner stehen auch in der
		<a href={helpHref('sicherung')}>Hilfe unter „Sicherung & Notfall“</a>.
	</p>

	{#if store.restoreProgress !== null}
		<SectionMessage tone="info" live title="Wiederherstellung läuft">
			{RESTORE_PROGRESS_TEXTS[store.restoreProgress]} Die Seite meldet sich, sobald die App wieder da
			ist; bitte nicht schließen.
		</SectionMessage>
	{/if}
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
			<div class="row">
				<dt>Letzte Prüfung</dt>
				<dd>{verifyText(overview.last.verify)}</dd>
			</div>
			{#if overview.restore !== null}
				<div class="row">
					<dt>Letzte Wiederherstellung</dt>
					<dd>{restoreText(overview.restore)}</dd>
				</div>
			{/if}
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
		{#if newest !== null}
			<div class="action">
				<button
					class="button-secondary"
					type="button"
					aria-disabled={busy}
					aria-busy={store.busy === 'verify'}
					aria-describedby={`${uid}-verify-hint`}
					onclick={() => {
						if (!busy) void store.verify(newest);
					}}
				>
					Jetzt prüfen
				</button>
				<p class="hint" id={`${uid}-verify-hint`}>
					Prüft die neueste Sicherung{newest.source === 'target' ? ' im Zielverzeichnis' : ''} so, als
					müsstest du sie wiederherstellen. Das macht die App auch einmal in der Woche von selbst.
				</p>
			</div>
		{/if}
		<div class="live" role="status">
			{#if store.busy === 'run'}
				Sicherung läuft …
			{:else if store.busy === 'verify'}
				Prüfung läuft …
			{/if}
		</div>
	</section>

	<BackupSettings {store} {overview} />
	<BackupPassphrase {store} {overview} />
	<BackupList {store} {overview} />
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

	.live {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}
</style>
