<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import { loginUrlFor } from '$lib/guard';
	import { NEW_TICKET_LINK_ID, newTicketHref } from '$lib/ticket-links';
	import AreaSwitch from './AreaSwitch.svelte';

	// Header of every signed-in page (E2 plan, T-4; E3 plan, T-18): app name with the counter of
	// tickets that are not done, area switch, the main button "Neues Ticket" and the session.
	let {
		openCount = null,
		onquick
	}: {
		/** Tickets that are not done; null while the list is not loaded (no counter then). */
		openCount?: number | null;
		/** Opens the quick entry (E4 plan, package 6); without it there is no button. */
		onquick?: () => void;
	} = $props();

	const countLabel = $derived(
		openCount === 1 ? '1 nicht erledigtes Ticket' : `${openCount} nicht erledigte Tickets`
	);

	// Same target as the layout guard, which reacts to the ended session as well: the login page
	// with the current page as redirect.
	async function logout() {
		const target = loginUrlFor(page.url);
		auth.logout();
		await goto(target, { replaceState: true });
	}
</script>

<header class="app-header">
	<div class="brand-group">
		<h1 class="brand">becauseyoulovejira</h1>
		{#if openCount !== null}
			<span class="counter">
				<span aria-hidden="true">{openCount}</span>
				<span class="visually-hidden">{countLabel}</span>
			</span>
		{/if}
	</div>
	<AreaSwitch />
	{#if onquick}
		<button class="quick" type="button" aria-keyshortcuts="C Control+K" onclick={onquick}>
			Schnellerfassung <kbd>c</kbd>
		</button>
	{/if}
	<a
		class="button-primary new"
		class:after-quick={onquick !== undefined}
		id={NEW_TICKET_LINK_ID}
		href={newTicketHref(page.url)}
	>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
		</svg>
		Neues Ticket
	</a>
	<a class="settings" href={resolve('/einstellungen/kanaele')}>Kanäle</a>
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
		padding: 0.75rem 1.5rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-line);
	}

	.brand-group {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.brand {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-brand-text);
	}

	.counter {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: 0.625rem;
	}

	.new {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		margin-left: auto;
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.quick {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		margin-left: auto;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.quick kbd {
		padding: 0 0.25rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}

	.after-quick {
		margin-left: 0;
	}

	.settings {
		font-size: 0.875rem;
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
