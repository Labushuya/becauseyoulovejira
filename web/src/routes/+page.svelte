<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import { loginUrlFor } from '$lib/guard';

	// Same target as the layout guard, which reacts to the ended session as well.
	async function logout() {
		auth.logout();
		await goto(loginUrlFor(page.url), { replaceState: true });
	}
</script>

<header class="app-header">
	<h1 class="brand">becauseyoulovejira</h1>
	<div class="session">
		<p class="user">Angemeldet als <strong>{auth.email}</strong></p>
		<button class="logout" type="button" onclick={logout}>Abmelden</button>
	</div>
</header>

<style>
	.app-header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-line);
	}

	.brand {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-brand-text);
	}

	.session {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		font-size: 0.875rem;
	}

	.user {
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.user strong {
		font-weight: 500;
		color: var(--color-text);
	}

	.logout {
		padding: 0.375rem 0.75rem;
		background: none;
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
