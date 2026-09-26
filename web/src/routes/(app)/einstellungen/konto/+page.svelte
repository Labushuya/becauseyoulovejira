<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';

	// Settings "Konto" (ADR-0026 section 1, plan EH-8): shows the signed-in app account and where
	// accounts are managed. Display only: "Passwort ändern" stays deferred (PocketBase allows it with
	// oldPassword, but it needs own rules and tests), and "Abmelden" stays in the header. The link to
	// the administration leaves the app (PocketBase's own UI), hence rel="external".
</script>

<svelte:head>
	<title>Konto · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<dl class="account">
	<div class="row">
		<dt>Angemeldet als</dt>
		<dd class="email">{auth.email}</dd>
	</div>
	<div class="row">
		<dt>Art</dt>
		<dd>App-Konto: Ihm gehören deine Tickets, Projekte, Tags und Verbindungen.</dd>
	</div>
</dl>

<SectionMessage tone="info" title="Konten verwalten">
	<p>
		Neue Nutzer und neue Passwörter für App-Konten legst du in der Verwaltung von PocketBase an,
		dort unter „Collections → users“. Anmelden kannst du dich dort nur mit dem <strong
			>Admin-Konto</strong
		>; es ist ein eigenes Konto mit eigenem Passwort, auch wenn es dieselbe E-Mail-Adresse hat. Ein
		vergessenes Admin-Passwort setzt <code>admin-zuruecksetzen.bat</code> im Ordner <code>app</code> neu.
	</p>
	{#snippet actions()}
		<a href="/_/" rel="external">Verwaltung öffnen (nur mit dem Admin-Konto)</a>
	{/snippet}
</SectionMessage>

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
		font-size: 0.875rem;
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		flex: 0 0 10rem;
		color: var(--color-text-muted);
	}

	dd {
		flex: 1 1 16rem;
		overflow-wrap: anywhere;
	}

	.email {
		font-weight: 500;
	}
</style>
