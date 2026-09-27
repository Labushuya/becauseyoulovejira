<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import { QUICK_CAPTURE_KEYSHORTCUTS } from '$lib/domain/shortcuts';
	import { loginUrlFor } from '$lib/guard';
	import { isSettingsPath } from '$lib/settings-sections';
	import { NEW_TICKET_LINK_ID, newTicketHref } from '$lib/ticket-links';
	import AreaSwitch from './AreaSwitch.svelte';
	import HelpMenu from './help/HelpMenu.svelte';
	import ThemeMenu from './ThemeMenu.svelte';

	// Header of every signed-in page (E2 plan, T-4; E3 plan, T-18; ADR-0025 section 10): app name
	// with the counter of tickets that are not done, area switch, the main button "Neues Ticket",
	// the help menu "?" (EH-9), the gear "Einstellungen", the theme switcher and the session. The app
	// name leads to "Aufgaben"; the gear is an icon button like the theme switcher and carries
	// aria-current in the settings (ADR-0026 section 1, EH-1). From 64rem the header stays at the top
	// while the page scrolls, and its height goes to --app-header-height, below which the embedded
	// side panel stands (package UI-6b). While a side panel covers the view (below 64rem) it is inert.
	let {
		openCount = null,
		covered = false,
		onquick,
		onshortcuts,
		ontour
	}: {
		/** Tickets that are not done; null while the list is not loaded (no counter then). */
		openCount?: number | null;
		/** A side panel lies over the view; the header is then not reachable either. */
		covered?: boolean;
		/** Opens the quick entry (E4 plan, package 6); without it there is no button. */
		onquick?: () => void;
		/** Opens the modal "Tastaturkürzel" (EH-9); without it there is no help menu. */
		onshortcuts?: () => void;
		/** Starts the guided tour (EH-13); the help menu then offers "Kurze Einführung". */
		ontour?: () => void;
	} = $props();

	const inSettings = $derived(isSettingsPath(page.url.pathname));

	const countLabel = $derived(
		openCount === 1 ? '1 nicht erledigtes Ticket' : `${openCount} nicht erledigte Tickets`
	);

	let header = $state<HTMLElement>();

	// Height of the header for the sticky side panel; the header wraps on narrow windows.
	$effect(() => {
		if (header === undefined || typeof ResizeObserver !== 'function') return;
		const root = document.documentElement;
		const target = header;
		const observer = new ResizeObserver(() => {
			root.style.setProperty('--app-header-height', `${target.offsetHeight}px`);
		});
		observer.observe(target);
		return () => {
			observer.disconnect();
			root.style.removeProperty('--app-header-height');
		};
	});

	// Same target as the layout guard, which reacts to the ended session as well: the login page
	// with the current page as redirect.
	async function logout() {
		const target = loginUrlFor(page.url);
		auth.logout();
		await goto(target, { replaceState: true });
	}
</script>

<header class="app-header" inert={covered} bind:this={header}>
	<div class="brand-group">
		<h1 class="brand"><a href={resolve('/')}>becauseyoulovejira</a></h1>
		{#if openCount !== null}
			<span class="counter">
				<span aria-hidden="true">{openCount}</span>
				<span class="visually-hidden">{countLabel}</span>
			</span>
		{/if}
	</div>
	<AreaSwitch />
	{#if onquick}
		<button
			class="quick"
			type="button"
			aria-keyshortcuts={QUICK_CAPTURE_KEYSHORTCUTS}
			data-tour="quick-capture"
			onclick={onquick}
		>
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
	{#if onshortcuts}
		<HelpMenu {onshortcuts} {ontour} />
	{/if}
	<a
		class="button-icon settings"
		href={resolve('/einstellungen/kanaele')}
		aria-label="Einstellungen"
		title="Einstellungen"
		aria-current={inSettings ? 'page' : undefined}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
			<path
				d="M6.76 2.95L7.02 1.07L8.98 1.07L9.24 2.95L10.7 3.55L12.21 2.41L13.59 3.79L12.45 5.3L13.05 6.76L14.93 7.02L14.93 8.98L13.05 9.24L12.45 10.7L13.59 12.21L12.21 13.59L10.7 12.45L9.24 13.05L8.98 14.93L7.02 14.93L6.76 13.05L5.3 12.45L3.79 13.59L2.41 12.21L3.55 10.7L2.95 9.24L1.07 8.98L1.07 7.02L2.95 6.76L3.55 5.3L2.41 3.79L3.79 2.41L5.3 3.55Z"
			/>
			<circle cx="8" cy="8" r="2.25" />
		</svg>
	</a>
	<ThemeMenu />
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
		/*
		 * Glass of the control layer (ADR-0029): from 64rem the view scrolls below the sticky header.
		 * No descendant with position: fixed, because backdrop-filter would become its containing
		 * block (glass-allowlist.test.ts); popovers live in the top layer.
		 */
		background: var(--material-regular);
		backdrop-filter: var(--glass-filter-regular);
		border-bottom: 1px solid var(--color-separator);
	}

	@media (min-width: 64rem) {
		.app-header {
			position: sticky;
			top: 0;
			z-index: 5;
		}
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

	/* The app name leads to "Aufgaben": no underline, a visible focus from base.css. */
	.brand a {
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius-control);
	}

	.brand a:hover {
		text-decoration: underline;
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
		border-radius: var(--radius-pill);
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
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.quick kbd {
		padding: 0 0.25rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-item);
	}

	.after-quick {
		margin-left: 0;
	}

	.settings svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.25;
		stroke-linejoin: round;
	}

	/* In the settings: surface "Marke Fläche / Text darauf" besides aria-current. */
	.settings[aria-current='page'] {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
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
		border-radius: var(--radius-control);
		cursor: pointer;
	}
</style>
