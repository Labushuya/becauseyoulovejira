<script lang="ts">
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		CREDENTIAL_MODE_TEXTS,
		CREDENTIAL_MODES,
		RESTORE_CONFIRM_WORD,
		SAFETY_KEEP_DAYS,
		verifyCountsText,
		type BackupOverview,
		type CredentialMode
	} from '$lib/domain/backup';
	import { formatPointInTime } from '$lib/domain/system';
	import type { BackupStore, RestoreDraft } from '$lib/stores/backup.svelte';

	// Strong confirmation of a restore (ADR-0046 §7) right below its backup, without a dialog: what
	// the check found, the access data of the backup by name with the choice what happens to them,
	// and the word WIEDERHERSTELLEN. The restore runs as a process of its own; BackupView follows it.
	let {
		store,
		overview,
		draft,
		oncancel
	}: {
		store: BackupStore;
		overview: BackupOverview;
		draft: RestoreDraft;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		summary: `${uid}-summary`,
		modes: `${uid}-modes`,
		word: `${uid}-word`,
		wordError: `${uid}-word-error`
	};

	let mode = $state<CredentialMode>('missing');
	let word = $state('');
	let wordInput = $state<HTMLInputElement | null>(null);

	const busy = $derived(store.busy !== null);
	const variables = $derived(draft.result.variables);
	const missing = $derived(variables.filter((name) => !overview.variables.includes(name)));
	const when = $derived(formatPointInTime(draft.result.createdUtc ?? draft.at));
	const counts = $derived(verifyCountsText(draft.result));
	const wordError = $derived(
		store.restoreProblem === 'confirm' ? `Bitte genau ${RESTORE_CONFIRM_WORD} eintippen.` : ''
	);

	$effect(() => {
		wordInput?.focus();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		await store.restore(variables.length > 0 ? mode : 'none', word);
		if (store.restoreProblem === 'confirm') wordInput?.focus();
	}
</script>

<form class="restore" novalidate aria-labelledby={ids.title} onsubmit={submit}>
	<h4 id={ids.title}>Sicherung vom {when} wiederherstellen</h4>
	<SectionMessage tone="warning" compact>
		<span id={ids.summary}>
			Geprüft: in Ordnung{counts === '' ? '' : ` (${counts})`}. Danach sind alle Daten der App auf
			dem Stand dieser Sicherung; was seitdem dazukam, ist dann nicht mehr in der App. Die jetzigen
			Daten bleiben {SAFETY_KEEP_DAYS} Tage als Sicherheitskopie im Ordner app. Die App ist dabei etwa
			eine Minute nicht erreichbar.
		</span>
	</SectionMessage>
	{#if variables.length > 0}
		<fieldset aria-describedby={ids.modes}>
			<legend class="label">Zugangsdaten aus der Sicherung</legend>
			<p class="hint" id={ids.modes}>
				In der Sicherung: {variables.join(', ')}.
				{#if missing.length > 0}Auf diesem Windows-Konto fehlen: {missing.join(', ')}.{/if}
				Die Werte gehen in die Windows-Umgebungsvariablen deines Kontos, nie in die App.
			</p>
			{#each CREDENTIAL_MODES as choice (choice)}
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-mode`}
						value={choice}
						checked={mode === choice}
						onchange={() => (mode = choice)}
					/>
					<span>{CREDENTIAL_MODE_TEXTS[choice]}</span>
				</label>
			{/each}
		</fieldset>
	{/if}
	<label class="label" for={ids.word}>Zur Bestätigung {RESTORE_CONFIRM_WORD} eintippen</label>
	<input
		id={ids.word}
		type="text"
		autocomplete="off"
		spellcheck="false"
		bind:this={wordInput}
		bind:value={word}
		aria-invalid={wordError === '' ? undefined : 'true'}
		aria-describedby={wordError === '' ? ids.summary : `${ids.wordError} ${ids.summary}`}
	/>
	{#if wordError !== ''}
		<p class="field-error" id={ids.wordError}><ErrorIcon /><span>{wordError}</span></p>
	{/if}
	<div class="buttons">
		<button
			class="button-primary"
			type="submit"
			aria-disabled={busy}
			aria-busy={store.busy === 'restore'}
		>
			Wiederherstellen
		</button>
		<button class="button-subtle" type="button" onclick={oncancel}>Abbrechen</button>
	</div>
</form>

<style>
	.restore {
		display: grid;
		flex: 1 1 100%;
		gap: 0.5rem;
		max-width: 36rem;
		padding: 0.25rem 0 0.75rem;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	fieldset {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.choice {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
