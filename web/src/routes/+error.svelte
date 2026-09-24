<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CenteredCard from '$lib/components/CenteredCard.svelte';

	// Rendered inside the root layout, so the route guard has already run (E1.1).
	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? 'Seite nicht gefunden' : 'Etwas ist schiefgelaufen');
	const body = $derived(
		notFound
			? 'Diese Adresse gibt es in becauseyoulovejira nicht.'
			: 'Die Seite konnte nicht geladen werden. Bitte lade sie neu oder versuche es später erneut.'
	);
</script>

<svelte:head>
	<title>{title} · becauseyoulovejira</title>
</svelte:head>

<CenteredCard labelledby="error-title">
	<p class="brand">becauseyoulovejira</p>
	<h1 id="error-title">{title}</h1>
	<p class="body">{body}</p>
	<p class="status">Fehlercode {page.status}</p>
	<a class="button-primary" href={resolve('/')}>Zur Startseite</a>
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

	.body {
		margin-top: 0.5rem;
		color: var(--color-text-muted);
	}

	.status {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	a {
		width: 100%;
		margin-top: 1.5rem;
		text-decoration: none;
	}
</style>
