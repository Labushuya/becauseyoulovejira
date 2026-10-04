<script lang="ts">
	import { untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import Field from '$lib/components/form/Field.svelte';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import PcOnly from '$lib/components/guidance/PcOnly.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import { NAME_MAX, PASSWORD_MIN } from '$lib/domain/accounts';
	import { helpHref } from '$lib/settings-sections';
	import { appContext } from '$lib/stores/context.svelte';
	import type { OwnAccountStore, PasswordField } from '$lib/stores/own-account.svelte';

	// The own app account (ADR-0056 §3): e-mail, display name and right; "Anzeigename" and "Passwort
	// ändern" as two forms with errors at their fields (ADR-0009), results as flags. The old password
	// is required (PocketBase checks it), the new one twice with the minimum of PocketBase; the
	// fields are Fields (UI-1, ADR-0060). Who manages accounts: the administrator on "Konten
	// verwalten"; the administrator also learns about the separate admin account of PocketBase and
	// admin-zuruecksetzen.bat, on the machine of the app only, where the admin UI and the script work
	// (KOB-1, ADR-0057).
	let {
		store,
		email,
		name,
		admin,
		accountsHref
	}: {
		store: OwnAccountStore;
		email: string;
		name: string;
		/** The account is the administrator of the app. */
		admin: boolean;
		/** Address of the page "Konten verwalten". */
		accountsHref: ResolvedPathname;
	} = $props();

	const uid = $props.id();

	let draft = $state(untrack(() => name));
	let nameError = $state('');
	let nameFormError = $state('');
	let nameInput = $state<HTMLInputElement>();

	let current = $state('');
	let next = $state('');
	let again = $state('');
	let passwordErrors = $state<Partial<Record<PasswordField, string>>>({});
	let passwordFormError = $state('');
	const inputs: Partial<Record<PasswordField, HTMLInputElement>> = $state({});

	const busy = $derived(store.busy !== null);

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		nameFormError = '';
		const outcome = await store.saveName(draft);
		if (outcome.ok) {
			draft = draft.trim();
			nameError = '';
			return;
		}
		nameError = outcome.fields.name ?? '';
		nameFormError = outcome.form;
		if (nameError !== '') nameInput?.focus();
	}

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		passwordFormError = '';
		const outcome = await store.changePassword({ current, next, again }, PASSWORD_MIN);
		if (outcome.ok) {
			current = '';
			next = '';
			again = '';
			passwordErrors = {};
			return;
		}
		passwordErrors = outcome.fields;
		passwordFormError = outcome.form;
		const first = (['current', 'next', 'again'] as const).find((field) => outcome.fields[field]);
		if (first !== undefined) inputs[first]?.focus();
	}

	function clearError(field: PasswordField) {
		if (passwordErrors[field] === undefined) return;
		const rest = { ...passwordErrors };
		delete rest[field];
		passwordErrors = rest;
	}
</script>

<dl class="account">
	<div class="row">
		<dt>Angemeldet als</dt>
		<dd class="email">{email}</dd>
	</div>
	<div class="row">
		<dt>Art</dt>
		<dd class="kind">
			<span>App-Konto: Ihm gehören deine Tickets, Projekte, Tags und Verbindungen.</span>
			{#if admin}
				<Lozenge label="Verwalter der App" icon="check" tone="brand" />
			{/if}
		</dd>
	</div>
</dl>

<section class="part" aria-labelledby={`${uid}-name-heading`}>
	<h3 id={`${uid}-name-heading`}>Anzeigename</h3>
	<form
		class="form"
		novalidate
		onsubmit={saveName}
		aria-busy={store.busy === 'name' ? 'true' : undefined}
	>
		<Field
			label="Name"
			hint="So sehen dich die anderen Konten deines Haushalts in Kommentaren, im Verlauf und im Papierkorb."
			error={nameError}
		>
			{#snippet control(field)}
				<div class="line">
					<input
						{...field}
						type="text"
						autocomplete="name"
						maxlength={NAME_MAX}
						bind:this={nameInput}
						bind:value={draft}
						oninput={() => (nameError = '')}
					/>
					<button
						class="button-secondary"
						type="submit"
						aria-disabled={busy ? 'true' : undefined}
						aria-busy={store.busy === 'name' ? 'true' : undefined}
					>
						Name speichern
					</button>
				</div>
			{/snippet}
		</Field>
		{#if nameFormError !== ''}
			<p class="alert-error" role="alert"><ErrorIcon /><span>{nameFormError}</span></p>
		{/if}
	</form>
</section>

<section class="part" aria-labelledby={`${uid}-password-heading`}>
	<h3 id={`${uid}-password-heading`}>Passwort ändern</h3>
	<form
		class="form"
		novalidate
		onsubmit={changePassword}
		aria-busy={store.busy === 'password' ? 'true' : undefined}
	>
		<Field label="Bisheriges Passwort" error={passwordErrors.current ?? ''}>
			{#snippet control(field)}
				<input
					{...field}
					type="password"
					autocomplete="current-password"
					bind:this={inputs.current}
					bind:value={current}
					oninput={() => clearError('current')}
				/>
			{/snippet}
		</Field>
		<Field
			label="Neues Passwort"
			hint={`Mindestens ${PASSWORD_MIN} Zeichen. Danach gilt nur noch das neue Passwort, auch auf anderen Geräten; hier bleibst du angemeldet.`}
			error={passwordErrors.next ?? ''}
		>
			{#snippet control(field)}
				<input
					{...field}
					type="password"
					autocomplete="new-password"
					bind:this={inputs.next}
					bind:value={next}
					oninput={() => clearError('next')}
				/>
			{/snippet}
		</Field>
		<Field label="Neues Passwort wiederholen" error={passwordErrors.again ?? ''}>
			{#snippet control(field)}
				<input
					{...field}
					type="password"
					autocomplete="new-password"
					bind:this={inputs.again}
					bind:value={again}
					oninput={() => clearError('again')}
				/>
			{/snippet}
		</Field>
		{#if passwordFormError !== ''}
			<p class="alert-error" role="alert"><ErrorIcon /><span>{passwordFormError}</span></p>
		{/if}
		<div>
			<button
				class="button-primary"
				type="submit"
				aria-disabled={busy ? 'true' : undefined}
				aria-busy={store.busy === 'password' ? 'true' : undefined}
			>
				Passwort ändern
			</button>
		</div>
	</form>
</section>

{#if admin}
	<SectionMessage tone="info" title="Konten verwalten">
		<p>
			Neue Konten, vergessene Passwörter und das Recht „Verwalter der App“ verwaltest du unter
			„Konten verwalten“. Die Verwaltung von PocketBase braucht ein eigenes <strong
				>Admin-Konto</strong
			>
			mit eigenem Passwort, auch wenn es dieselbe E-Mail-Adresse hat.
			<PcOnly need="script" inline>
				Ein vergessenes Admin-Passwort setzt <code>admin-zuruecksetzen.bat</code> im Ordner
				<code>app</code> neu.
			</PcOnly>
		</p>
		{#snippet actions()}
			<a href={accountsHref}>Zu „Konten verwalten“</a>
			{#if appContext.capabilities.pc}
				<a href="/_/" rel="external">Verwaltung öffnen (nur mit dem Admin-Konto)</a>
			{/if}
		{/snippet}
	</SectionMessage>
{:else}
	<SectionMessage tone="info" title="Konten verwalten">
		<p>
			Neue Konten und vergessene Passwörter richtet der Verwalter der App ein, also die Person, die
			becauseyoulovejira eingerichtet hat.
			<a href={helpHref('konten')}>Mehr zu Konten und Verwaltern</a>
		</p>
	</SectionMessage>
{/if}

<style>
	.account {
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

	.email {
		font-weight: 500;
	}

	.kind {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
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
		max-width: 32rem;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.line input {
		flex: 1 1 min(16rem, 100%);
	}
</style>
