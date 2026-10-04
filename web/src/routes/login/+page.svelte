<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth, type LoginFailure } from '$lib/auth.svelte';
	import CenteredCard from '$lib/components/CenteredCard.svelte';
	import { safeRedirect } from '$lib/guard';

	// One message for every refusal, so the page never reveals whether an e-mail exists. Too many
	// attempts and server errors do not depend on the account (E2 plan, T-18).
	const MESSAGES: Record<LoginFailure, string> = {
		rejected: 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.',
		// The rate limiter of the server (ADR-0055) blocks for up to a minute, at "Streng" up to five.
		rate_limited:
			'Zu viele Anmeldeversuche. Zum Schutz vor Rateversuchen ist die Anmeldung kurz gesperrt. Bitte ein paar Minuten warten und dann erneut versuchen.',
		server: 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.',
		network:
			'Server nicht erreichbar. Bitte prüfen, ob becauseyoulovejira gestartet ist (start.bat), und erneut versuchen.',
		// Only after the right password of a disabled account (ADR-0056 §3), so it reveals nothing.
		disabled: 'Dieses Konto ist deaktiviert. Bitte wende dich an den Verwalter der App.'
	};

	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let message = $state('');
	let rejected = $state(false);
	let emailInput = $state<HTMLInputElement>();
	let passwordInput = $state<HTMLInputElement>();

	const target = $derived(safeRedirect(page.url.searchParams.get('redirect'), page.url.origin));

	$effect(() => {
		emailInput?.focus();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		message = '';
		rejected = false;

		const result = await auth.login(email, password);
		if (result.ok) {
			try {
				await goto(target, { replaceState: true });
			} finally {
				pending = false;
			}
			return;
		}

		message = MESSAGES[result.failure];
		rejected = result.failure === 'rejected';
		password = '';
		pending = false;
		passwordInput?.focus();
	}
</script>

<svelte:head>
	<title>Anmelden · becauseyoulovejira</title>
</svelte:head>

<CenteredCard labelledby="login-title">
	<p class="brand">becauseyoulovejira</p>
	<h1 id="login-title">Anmelden</h1>

	<div aria-live="polite">
		{#if message}
			<p class="alert-error message">
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
					<path d="M8 4.5v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					<circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
				</svg>
				<span>{message}</span>
			</p>
			{#if rejected}
				<!-- Shown for every refusal, so it reveals nothing about the e-mail address. -->
				<p class="note">Hinweis: Das Admin-Konto gilt nur für die Verwaltung, nicht für die App.</p>
			{/if}
		{/if}
	</div>

	<form onsubmit={submit}>
		<div class="field">
			<label for="login-email">E-Mail</label>
			<input
				id="login-email"
				name="email"
				type="email"
				autocomplete="username"
				required
				bind:value={email}
				bind:this={emailInput}
			/>
		</div>
		<div class="field">
			<label for="login-password">Passwort</label>
			<input
				id="login-password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				bind:value={password}
				bind:this={passwordInput}
			/>
		</div>
		<button
			class="button-primary"
			type="submit"
			disabled={pending}
			aria-busy={pending ? 'true' : undefined}
		>
			{#if pending}
				<span class="spinner" aria-hidden="true"></span>
				Anmeldung läuft …
			{:else}
				Anmelden
			{/if}
		</button>
	</form>

	<div class="hints">
		<p>
			Kein Zugang oder Passwort vergessen? Wende dich an die Person, die becauseyoulovejira
			eingerichtet hat.
		</p>
		<!-- rel="external": the admin UI is not part of the SPA (full page load). -->
		<p><a class="admin-link" href="/_/" rel="external">Verwaltung (nur Admin)</a></p>
	</div>
</CenteredCard>

<style>
	.brand {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-brand-text);
	}

	h1 {
		margin-top: 0.25rem;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.message {
		margin-top: 1.25rem;
	}

	form {
		display: grid;
		gap: 1rem;
		margin-top: 1.25rem;
	}

	.field {
		display: grid;
		gap: 0.375rem;
	}

	label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	button {
		margin-top: 0.5rem;
	}

	.spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.hints {
		display: grid;
		gap: 0.5rem;
		margin-top: 1.5rem;
		padding-top: 1rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-line);
	}

	.note {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.admin-link {
		color: var(--color-text-muted);
	}
</style>
