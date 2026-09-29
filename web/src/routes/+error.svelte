<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { claimReload, sessionStorageOf } from '$lib/app-update';
	import CenteredCard from '$lib/components/CenteredCard.svelte';
	import { loadFully, reloadPage } from '$lib/page-reload';

	// Rendered inside the root layout, so the route guard has already run (E1.1). A module that
	// could not be loaded, usually because a new build replaced it (ADR-0040), makes the page load
	// the address once more by itself; the guard in sessionStorage stops a loop, after that the
	// page offers "Neu laden". Both ways out load a new document, so a broken client state ends.
	let reloading = $state(false);

	$effect(() => {
		if (page.error?.kind !== 'module-load') return;
		const href = page.url.href;
		untrack(() => {
			if (!claimReload(sessionStorageOf(window), href, Date.now())) return;
			reloading = true;
			loadFully(href);
		});
	});

	const notFound = $derived(page.status === 404);
	const title = $derived(
		reloading
			? 'Neue Version wird geladen …'
			: notFound
				? 'Seite nicht gefunden'
				: 'Etwas ist schiefgelaufen'
	);
	const body = $derived(
		reloading
			? 'becauseyoulovejira wurde aktualisiert. Die Seite lädt gleich neu.'
			: notFound
				? 'Diese Adresse gibt es in becauseyoulovejira nicht.'
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
	{#if !reloading}
		<p class="status">Fehlercode {page.status}</p>
		<div class="actions">
			{#if !notFound}
				<button class="button-primary" type="button" onclick={reloadPage}>Neu laden</button>
			{/if}
			<a
				class={notFound ? 'button-primary' : 'button-secondary'}
				href={resolve('/')}
				data-sveltekit-reload>Zur Übersicht</a
			>
		</div>
	{/if}
</CenteredCard>

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
