<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { viewOfRoute } from '$lib/domain/area';
	import { isSettingsPath } from '$lib/settings-sections';
	import { VIEW_LABELS } from '$lib/views';
	import AreaSwitch from '../AreaSwitch.svelte';

	// Compact top bar of the phone frame (MO-1a, ADR-0073): one line with the name of the view and
	// the area switch "Privat | Haushalt" with targets of 44 px; nothing wraps. It takes the place of
	// the header of the PC: "Neues Ticket", help, settings, appearance and the session are under
	// "Mehr" of the bottom bar, the quick entry is its "＋". The name stands here once on the screen;
	// screen readers hear the heading of the view (SectionBar, hidden on the screen in the frame) and,
	// as on the PC, the name of the app as the heading of the page. It stays at the top while the page
	// scrolls, with the safe area of the status bar above it, and is inert while a side panel covers
	// the view, like the header. Since OF-2 the symbol of the outbox stands before the area switch
	// while it has something to say (`status`).
	let {
		covered = false,
		status
	}: {
		/** A side panel lies over the view; the bar is then not reachable either. */
		covered?: boolean;
		/** The symbol of the outbox ("Offline · 3"), before the area switch. */
		status?: Snippet;
	} = $props();

	const view = $derived(viewOfRoute(page.route.id));
	const title = $derived(
		view !== null
			? VIEW_LABELS[view]
			: isSettingsPath(page.url.pathname)
				? 'Einstellungen'
				: 'becauseyoulovejira'
	);
</script>

<header class="top-bar" inert={covered} data-phone-frame="top-bar">
	<h1 class="visually-hidden">becauseyoulovejira</h1>
	<p class="title" aria-hidden="true">{title}</p>
	<div class="end">
		{@render status?.()}
		<AreaSwitch phone />
	</div>
</header>

<style>
	/*
	 * Glass of the control layer like the header (ADR-0029): the page scrolls below it. No descendant
	 * with position: fixed (glass-allowlist.test.ts).
	 */
	.top-bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		min-height: calc(var(--top-bar-height) + var(--safe-top));
		padding: var(--safe-top) var(--page-inline) 0;
		background: var(--material-regular);
		backdrop-filter: var(--glass-filter-regular);
		border-bottom: 1px solid var(--color-separator);
	}

	.title {
		min-width: 0;
		overflow: hidden;
		font-size: var(--font-size-title);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.end {
		display: flex;
		flex: none;
		gap: 0.25rem;
		align-items: center;
	}
</style>
