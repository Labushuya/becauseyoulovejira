<script lang="ts">
	import { onNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import { shouldReloadOnNavigate } from '$lib/app-update';
	import { APP_UPDATED } from '$lib/guidance/texts';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Hint of the app layout once a new build is published while this tab is open (ADR-0040).
	// SvelteKit asks for /_app/version.json once a minute (svelte.config.js). The running version
	// keeps working, because the files of older builds stay, so the hint is information, not a
	// warning (ADR-0009, ADR-0026 section 2). The next click on a link then loads its target as a
	// new document, unless typed text, a running bulk action or an offered "Rückgängig" would be
	// lost; the hint names unsaved input. The status region is always there, so screen readers
	// announce the hint; the focus never moves because of it.
	let {
		unsaved,
		pending,
		state = updated,
		reload = () => window.location.reload(),
		loadFully = (href: string) => window.location.assign(href)
	}: {
		/** Typed text that loading the page again would lose. */
		unsaved: () => boolean;
		/** Work that a full page load would cut off (bulk action, "Rückgängig" in a flag). */
		pending: () => boolean;
		state?: { readonly current: boolean };
		reload?: () => void;
		loadFully?: (href: string) => void;
	} = $props();

	/** How long a navigation waits for the new document before it goes on inside the app. */
	const UNLOAD_WAIT_MS = 5000;

	// onNavigate runs after every beforeNavigate, so the question "Änderungen verwerfen?" has
	// already been answered when a navigation gets here.
	onNavigate((navigation) => {
		const to = navigation.to;
		if (to === null) return;
		const reloadNow = shouldReloadOnNavigate({
			updated: state.current,
			type: navigation.type,
			willUnload: navigation.willUnload,
			busy: unsaved() || pending()
		});
		if (!reloadNow) return;
		loadFully(to.url.href);
		return new Promise<void>((resolve) => setTimeout(resolve, UNLOAD_WAIT_MS));
	});
</script>

<div class="app-update" class:shown={state.current} role="status">
	{#if state.current}
		<SectionMessage tone="info">
			{APP_UPDATED.text}
			{#if unsaved()}
				{APP_UPDATED.unsaved}
			{/if}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={reload}>{APP_UPDATED.reload}</button>
			{/snippet}
		</SectionMessage>
	{/if}
</div>

<style>
	.shown {
		margin-bottom: 1rem;
	}
</style>
