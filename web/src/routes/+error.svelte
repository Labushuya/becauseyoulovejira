<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { claimReload, sessionStorageOf } from '$lib/app-update';
	import CenteredCard from '$lib/components/CenteredCard.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import { OFFLINE_TEXTS } from '$lib/domain/offline';
	import { getOutbox } from '$lib/offline/app-outbox';
	import { getConnectivity } from '$lib/offline/connectivity.svelte';
	import { loadFully, reloadPage } from '$lib/page-reload';

	// Rendered inside the root layout, so the route guard has already run (E1.1). A module that
	// could not be loaded, usually because a new build replaced it (ADR-0040), makes the page load
	// the address once more by itself; the guard in sessionStorage stops a loop, after that the
	// page offers "Neu laden". Both ways out load a new document, so a broken client state ends.
	// Without a connection (known to the outbox, OF-2) a new document would not load: the page then
	// says that the view is not loaded yet and offers "Zurück"; "Neu laden" asks first while changes
	// are kept. Without the (app) layout nobody else watches the connection, so while the outbox
	// worked in this tab or knew the connection to be missing, the page watches it itself as long as
	// it is shown (OF-2b): back online it offers "Neu laden", and before it reloads on its own it asks
	// the server once. On the PC without the outbox it asks nothing and reloads as before.
	const connectivity = getConnectivity();
	const outbox = getOutbox();
	const watched = untrack(() => connectivity.offline || outbox.inUse);
	let reloading = $state(false);
	let asking = $state(false);
	const offline = $derived(connectivity.offline);
	const notLoaded = $derived(offline && page.error?.kind === 'module-load');

	$effect(() =>
		untrack(() => {
			if (!watched) return;
			const stop = connectivity.start(window);
			if (connectivity.offline) void connectivity.check();
			return stop;
		})
	);

	function reloadOnce(href: string) {
		if (!claimReload(sessionStorageOf(window), href, Date.now())) return;
		reloading = true;
		loadFully(href);
	}

	$effect(() => {
		if (page.error?.kind !== 'module-load') return;
		const href = page.url.href;
		untrack(() => {
			if (connectivity.offline) return;
			if (!watched) {
				reloadOnce(href);
				return;
			}
			void connectivity.check().then((reached) => {
				if (reached) reloadOnce(href);
			});
		});
	});

	function reload() {
		if (offline && outbox.count > 0) asking = true;
		else reloadPage();
	}

	const notFound = $derived(page.status === 404);
	const title = $derived(
		reloading
			? 'Neue Version wird geladen …'
			: notFound
				? 'Seite nicht gefunden'
				: notLoaded
					? OFFLINE_TEXTS.notLoadedTitle
					: 'Etwas ist schiefgelaufen'
	);
	const body = $derived(
		reloading
			? 'becauseyoulovejira wurde aktualisiert. Die Seite lädt gleich neu.'
			: notFound
				? 'Diese Adresse gibt es in becauseyoulovejira nicht.'
				: notLoaded
					? OFFLINE_TEXTS.notLoaded
					: page.error?.kind === 'module-load'
						? 'Ein Teil der App konnte nicht geladen werden, vermutlich wurde sie gerade aktualisiert oder neu gestartet. Lade die Seite neu.'
						: 'Die Seite konnte nicht geladen werden. Lade sie neu oder versuche es später erneut.'
	);
</script>

<svelte:head>
	<title>{title} · becauseyoulovejira</title>
</svelte:head>

<CenteredCard labelledby="error-title">
	<p class="brand">becauseyoulovejira</p>
	<h1 id="error-title">{title}</h1>
	<p class="body">{body}</p>
	{#if notLoaded}
		<div class="actions">
			<button class="button-primary" type="button" onclick={() => window.history.back()}
				>{OFFLINE_TEXTS.back}</button
			>
		</div>
	{:else if !reloading}
		<p class="status">Fehlercode {page.status}</p>
		<div class="actions">
			{#if !notFound}
				<button class="button-primary" type="button" onclick={reload}>Neu laden</button>
			{/if}
			<a
				class={notFound ? 'button-primary' : 'button-secondary'}
				href={resolve('/')}
				data-sveltekit-reload>Zur Übersicht</a
			>
		</div>
	{/if}
</CenteredCard>

{#if asking}
	<ConfirmDialog
		open
		title={OFFLINE_TEXTS.reloadTitle}
		confirmLabel={OFFLINE_TEXTS.reloadConfirm}
		onconfirm={() => {
			asking = false;
			reloadPage();
		}}
		oncancel={() => (asking = false)}
	>
		{OFFLINE_TEXTS.reloadText(outbox.count)}
	</ConfirmDialog>
{/if}

<style>
	.brand {
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-brand-text);
	}

	h1 {
		margin-top: 0.25rem;
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.body {
		margin-top: 0.5rem;
		color: var(--color-text-muted);
	}

	.status {
		margin-top: 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	a {
		text-decoration: none;
	}
</style>
