<script lang="ts">
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		PASSPHRASE_MIN_LENGTH,
		PASSPHRASE_PROBLEM_TEXTS,
		PASSPHRASE_STATE_TEXTS,
		PASSPHRASE_TEXTS,
		passphraseProblem,
		type BackupOverview
	} from '$lib/domain/backup';
	import type { BackupStore } from '$lib/stores/backup.svelte';

	// Passphrase of the sealed backups (ADR-0046 §3): typed twice, sent once in the body of a POST,
	// kept by the control script with DPAPI for this Windows account. The fields are emptied after
	// saving; nothing of it is stored in the page or the browser.
	let { store, overview }: { store: BackupStore; overview: BackupOverview } = $props();

	const uid = $props.id();
	const ids = {
		passphrase: `${uid}-passphrase`,
		confirmation: `${uid}-confirmation`,
		hint: `${uid}-hint`,
		error: `${uid}-error`
	};

	let passphrase = $state('');
	let confirmation = $state('');

	const busy = $derived(store.busy !== null);
	const isSet = $derived(overview.passphrase === 'set');
	const error = $derived(
		store.passphraseProblem === null ? '' : PASSPHRASE_PROBLEM_TEXTS[store.passphraseProblem]
	);
	// The length belongs to the first field, a mismatch to the second.
	const errorOnFirst = $derived(
		store.passphraseProblem === 'too-short' ||
			store.passphraseProblem === 'too-long' ||
			store.passphraseProblem === 'character'
	);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const problem = passphraseProblem(passphrase, confirmation);
		store.markPassphrase(problem);
		if (problem !== null) return;
		if (await store.savePassphrase(passphrase, confirmation)) {
			passphrase = '';
			confirmation = '';
		}
	}
</script>

<section class="part" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`}>Passphrase</h3>
	<p class="state">{PASSPHRASE_STATE_TEXTS[overview.passphrase]}</p>
	<SectionMessage tone="warning" compact>{PASSPHRASE_TEXTS.keep}</SectionMessage>
	<form class="form" novalidate aria-busy={store.busy === 'passphrase'} onsubmit={save}>
		<label class="label" for={ids.passphrase}>{isSet ? 'Neue Passphrase' : 'Passphrase'}</label>
		<input
			id={ids.passphrase}
			type="password"
			autocomplete="new-password"
			bind:value={passphrase}
			aria-invalid={error !== '' && errorOnFirst ? 'true' : undefined}
			aria-describedby={error !== '' && errorOnFirst ? `${ids.error} ${ids.hint}` : ids.hint}
		/>
		<label class="label" for={ids.confirmation}>Passphrase wiederholen</label>
		<input
			id={ids.confirmation}
			type="password"
			autocomplete="new-password"
			bind:value={confirmation}
			aria-invalid={error !== '' && !errorOnFirst ? 'true' : undefined}
			aria-describedby={error !== '' && !errorOnFirst ? ids.error : undefined}
		/>
		{#if error !== ''}
			<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
		{/if}
		<p class="hint" id={ids.hint}>
			Mindestens {PASSPHRASE_MIN_LENGTH} Zeichen; am besten mehrere Wörter. {PASSPHRASE_TEXTS.bound}
			{#if isSet}{PASSPHRASE_TEXTS.change}{/if}
		</p>
		<div>
			<button
				class="button-secondary"
				type="submit"
				aria-disabled={busy}
				aria-busy={store.busy === 'passphrase'}
			>
				{isSet ? 'Passphrase ändern' : 'Passphrase festlegen'}
			</button>
		</div>
	</form>
</section>

<style>
	.hint,
	.state {
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

	.form {
		display: grid;
		gap: 0.375rem;
		max-width: 28rem;
	}
</style>
