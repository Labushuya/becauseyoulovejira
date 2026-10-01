<script lang="ts">
	import { tick } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import {
		SAFETY_KEEP_DAYS,
		VERIFY_REASON_TEXTS,
		type BackupFile,
		type BackupOverview,
		type BackupSource
	} from '$lib/domain/backup';
	import { formatPointInTime, sizeText } from '$lib/domain/system';
	import type { BackupStore } from '$lib/stores/backup.svelte';
	import BackupRestorePanel from './BackupRestorePanel.svelte';

	// The backups here and in the target folder, each with "Prüfen" (ADR-0046 §6) and
	// "Wiederherstellen …" (§7), and the safety copies of earlier restores. When the stored
	// passphrase does not open a sealed backup (none stored, or an older backup with an earlier
	// passphrase), the page asks for its passphrase right below it, without a dialog; the passphrase
	// is sent with the check (and a restore after it) only and never kept. The confirmation of a
	// restore stands below its backup as well.
	let { store, overview }: { store: BackupStore; overview: BackupOverview } = $props();

	const uid = $props.id();
	const busy = $derived(store.busy !== null);
	const request = $derived(store.passphraseRequest);
	const draft = $derived(store.restoreDraft);

	let passphrase = $state('');
	let askInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		askInput?.focus();
	});

	function fileText(file: BackupFile): string {
		return `${formatPointInTime(file.at)} · ${sizeText(file.bytes)}`;
	}

	function where(source: BackupSource): string {
		return source === 'target' ? 'im Zielverzeichnis' : 'im Ordner app';
	}

	function buttonId(source: BackupSource, index: number, action: 'check' | 'restore'): string {
		return `${uid}-${source}-${action}-${index}`;
	}

	function asked(source: BackupSource, name: string): boolean {
		return request !== null && request.source === source && request.name === name;
	}

	function drafted(source: BackupSource, name: string): boolean {
		return draft !== null && draft.source === source && draft.name === name;
	}

	/** Whether a check runs for this backup: for "Prüfen" (`restore` false) or before a restore. */
	function checking(source: BackupSource, name: string, restore: boolean): boolean {
		const current = store.verifying;
		return (
			current !== null &&
			current.source === source &&
			current.name === name &&
			current.restore === restore
		);
	}

	function check(source: BackupSource, name: string) {
		if (busy) return;
		passphrase = '';
		store.cancelRestore();
		void store.verify({ source, name });
	}

	function restore(source: BackupSource, file: BackupFile) {
		if (busy) return;
		passphrase = '';
		store.cancelRestore();
		void store.prepareRestore({ source, name: file.name, at: file.at });
	}

	async function checkWithPassphrase(event: SubmitEvent, name: string) {
		event.preventDefault();
		if (busy || passphrase === '') return;
		const given = passphrase;
		passphrase = '';
		await store.answerPassphrase(given);
		// Still the wrong one: back into the field.
		if (asked('target', name)) askInput?.focus();
	}

	async function cancelAsk(index: number) {
		const action = request?.restoreAt === undefined ? 'check' : 'restore';
		passphrase = '';
		store.cancelPassphraseRequest();
		await tick();
		document.getElementById(buttonId('target', index, action))?.focus();
	}

	async function cancelRestore(source: BackupSource, index: number) {
		store.cancelRestore();
		await tick();
		document.getElementById(buttonId(source, index, 'restore'))?.focus();
	}
</script>

{#snippet actions(source: BackupSource, file: BackupFile, index: number)}
	<span class="actions">
		<button
			id={buttonId(source, index, 'check')}
			class="button-subtle"
			type="button"
			aria-disabled={busy}
			aria-busy={checking(source, file.name, false)}
			aria-label={`Sicherung vom ${formatPointInTime(file.at)} ${where(source)} prüfen`}
			onclick={() => check(source, file.name)}
		>
			Prüfen
		</button>
		<button
			id={buttonId(source, index, 'restore')}
			class="button-subtle"
			type="button"
			aria-disabled={busy}
			aria-busy={checking(source, file.name, true) ||
				(drafted(source, file.name) && store.busy === 'restore')}
			aria-label={`Sicherung vom ${formatPointInTime(file.at)} ${where(source)} wiederherstellen …`}
			onclick={() => restore(source, file)}
		>
			Wiederherstellen …
		</button>
	</span>
	{#if draft !== null && drafted(source, file.name)}
		<BackupRestorePanel
			{store}
			{overview}
			{draft}
			oncancel={() => void cancelRestore(source, index)}
		/>
	{/if}
{/snippet}

<section class="part" aria-labelledby={`${uid}-list`}>
	<h3 id={`${uid}-list`}>Sicherungen</h3>
	<p class="hint">
		„Prüfen“ öffnet eine Sicherung in einer Probe-Instanz: entschlüsseln, entpacken, Datenbank und
		Originaldateien prüfen, Einträge zählen. Das dauert etwa eine Minute; die App läuft dabei
		weiter. „Wiederherstellen …“ prüft genauso und fragt danach, ob die App auf diesen Stand
		zurückgehen soll.
	</p>
	<h4>Im Ordner app (pb_data\backups)</h4>
	{#if overview.local.length === 0}
		<p class="hint">Noch keine.</p>
	{:else}
		<ul class="files">
			{#each overview.local as file, index (file.name)}
				<li>
					<span class="what">
						<span>{fileText(file)}</span>
						<span class="hint">{file.ours ? 'Generation' : 'Andere Sicherung (bleibt)'}</span>
					</span>
					{@render actions('local', file, index)}
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
				{#each overview.sealed as file, index (file.name)}
					<li>
						<span class="what">
							<span>{fileText(file)}</span>
							<code class="hint">{file.name}</code>
						</span>
						{@render actions('target', file, index)}
						{#if request !== null && asked('target', file.name)}
							{@const inputId = `${uid}-ask-${index}`}
							{@const messageId = `${uid}-ask-message-${index}`}
							<form
								class="ask"
								novalidate
								aria-busy={checking('target', file.name, request.restoreAt !== undefined)}
								onsubmit={(event) => checkWithPassphrase(event, file.name)}
							>
								<label class="label" for={inputId}>Passphrase dieser Sicherung</label>
								<input
									id={inputId}
									type="password"
									autocomplete="off"
									bind:this={askInput}
									bind:value={passphrase}
									aria-invalid={request.reason === 'passphrase' ? 'true' : undefined}
									aria-describedby={messageId}
								/>
								{#if request.reason === 'passphrase'}
									<p class="field-error" id={messageId}>
										<ErrorIcon /><span
											>{VERIFY_REASON_TEXTS.passphrase} Ältere Sicherungen öffnet die Passphrase, die
											beim Sichern galt.</span
										>
									</p>
								{:else}
									<p class="hint" id={messageId}>
										Auf diesem Rechner ist keine Passphrase gespeichert. Sie geht nur mit dieser
										Prüfung an den Server und wird nicht gespeichert.
									</p>
								{/if}
								<div class="buttons">
									<button
										class="button-secondary"
										type="submit"
										aria-disabled={busy || passphrase === ''}
									>
										Mit dieser Passphrase prüfen
									</button>
									<button class="button-subtle" type="button" onclick={() => void cancelAsk(index)}>
										Abbrechen
									</button>
								</div>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if overview.safety.length > 0}
		<h4>Sicherheitskopien vor einer Wiederherstellung (Ordner app)</h4>
		<p class="hint">
			Die Daten von vor einer Wiederherstellung bleiben {SAFETY_KEEP_DAYS} Tage im Ordner app; danach
			entfernt die App sie.
		</p>
		<ul class="files">
			{#each overview.safety as copy (copy.name)}
				<li>
					<span class="what">
						<span>{formatPointInTime(copy.at)}</span>
						<code class="hint">{copy.name}</code>
					</span>
					<span class="hint">bis {formatPointInTime(copy.until)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
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

	.files {
		display: grid;
		gap: 0.25rem;
		list-style: none;
		font-size: var(--font-size-body);
	}

	.files li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.what {
		display: flex;
		flex: 1 1 18rem;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.actions,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.ask {
		display: grid;
		flex: 1 1 100%;
		gap: 0.375rem;
		max-width: 28rem;
		padding: 0.25rem 0 0.5rem;
	}
</style>
