<script lang="ts">
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import { emailProblem, nameProblem, problemText } from '$lib/domain/accounts';
	import type { AccountsStore } from '$lib/stores/accounts.svelte';

	// "Konto anlegen" (ADR-0056 §3): name and e-mail address of the person; the server makes the start
	// password and the page shows it once. Checks before sending with the rules of the hook, refusals
	// of the server at their field (ADR-0009), a general one below the form.
	let { store, oncreated }: { store: AccountsStore; oncreated: () => void } = $props();

	const uid = $props.id();
	const ids = {
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		email: `${uid}-email`,
		emailError: `${uid}-email-error`,
		emailHint: `${uid}-email-hint`
	};

	let name = $state('');
	let email = $state('');
	let nameError = $state('');
	let emailError = $state('');
	let formError = $state('');
	let nameInput = $state<HTMLInputElement>();
	let emailInput = $state<HTMLInputElement>();

	const running = $derived(store.busy?.kind === 'create');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (store.busy !== null) return;
		const nameCheck = nameProblem(name);
		const emailCheck = emailProblem(email);
		nameError = nameCheck === '' ? '' : problemText(nameCheck);
		emailError = emailCheck === '' ? '' : problemText(emailCheck);
		formError = '';
		if (nameError !== '') {
			nameInput?.focus();
			return;
		}
		if (emailError !== '') {
			emailInput?.focus();
			return;
		}
		const outcome = await store.create({ email: email.trim(), name: name.trim() });
		if (outcome.ok) {
			name = '';
			email = '';
			oncreated();
			return;
		}
		if (outcome.field === 'name') {
			nameError = outcome.message;
			nameInput?.focus();
		} else if (outcome.field === 'email') {
			emailError = outcome.message;
			emailInput?.focus();
		} else {
			formError = outcome.message;
		}
	}
</script>

<form class="form" novalidate onsubmit={submit} aria-busy={running ? 'true' : undefined}>
	<div class="field">
		<label class="label" for={ids.name}>Name</label>
		<input
			id={ids.name}
			type="text"
			autocomplete="off"
			maxlength="100"
			bind:this={nameInput}
			bind:value={name}
			oninput={() => (nameError = '')}
			aria-invalid={nameError === '' ? undefined : 'true'}
			aria-describedby={nameError === '' ? undefined : ids.nameError}
		/>
		{#if nameError !== ''}
			<p class="field-error" id={ids.nameError}><ErrorIcon /><span>{nameError}</span></p>
		{/if}
	</div>
	<div class="field">
		<label class="label" for={ids.email}>E-Mail-Adresse</label>
		<input
			id={ids.email}
			type="email"
			autocomplete="off"
			spellcheck="false"
			bind:this={emailInput}
			bind:value={email}
			oninput={() => (emailError = '')}
			aria-invalid={emailError === '' ? undefined : 'true'}
			aria-describedby={emailError === '' ? ids.emailHint : `${ids.emailError} ${ids.emailHint}`}
		/>
		{#if emailError !== ''}
			<p class="field-error" id={ids.emailError}><ErrorIcon /><span>{emailError}</span></p>
		{/if}
		<p class="hint" id={ids.emailHint}>
			Damit meldet sich die Person an. Die App schickt keine Mail; das Startpasswort gibst du selbst
			weiter.
		</p>
	</div>
	{#if formError !== ''}
		<p class="alert-error" role="alert"><ErrorIcon /><span>{formError}</span></p>
	{/if}
	<div>
		<button
			class="button-primary"
			type="submit"
			aria-disabled={store.busy !== null ? 'true' : undefined}
			aria-busy={running ? 'true' : undefined}
		>
			Konto anlegen
		</button>
	</div>
</form>

<style>
	.form {
		display: grid;
		gap: 0.75rem;
		max-width: 32rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
