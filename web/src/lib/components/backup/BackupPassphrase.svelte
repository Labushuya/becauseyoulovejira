<script lang="ts">
	import Field from '$lib/components/form/Field.svelte';
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

{#snippet passphraseHint()}
	Mindestens {PASSPHRASE_MIN_LENGTH} Zeichen; am besten mehrere Wörter. {PASSPHRASE_TEXTS.bound}
	{#if isSet}{PASSPHRASE_TEXTS.change}{/if}
{/snippet}

<section class="part" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`}>Passphrase</h3>
	<p class="state">{PASSPHRASE_STATE_TEXTS[overview.passphrase]}</p>
	<SectionMessage tone="warning" compact>{PASSPHRASE_TEXTS.keep}</SectionMessage>
	<form class="form" novalidate aria-busy={store.busy === 'passphrase'} onsubmit={save}>
		<Field
			label={isSet ? 'Neue Passphrase' : 'Passphrase'}
			hint={passphraseHint}
			error={errorOnFirst ? error : ''}
		>
			{#snippet control(field)}
				<input {...field} type="password" autocomplete="new-password" bind:value={passphrase} />
			{/snippet}
		</Field>
		<Field label="Passphrase wiederholen" error={errorOnFirst ? '' : error}>
			{#snippet control(field)}
				<input {...field} type="password" autocomplete="new-password" bind:value={confirmation} />
			{/snippet}
		</Field>
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
	.state {
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

	.form {
		display: grid;
		gap: 0.75rem;
		max-width: 28rem;
	}
</style>
