<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import favicon from '$lib/assets/favicon.svg';
	import { auth } from '$lib/auth.svelte';
	import SessionNotice from '$lib/components/SessionNotice.svelte';
	import { guardTarget } from '$lib/guard';

	let { children } = $props();

	// Where the route guard sends the current URL (null: show it), decided once the session
	// state is known.
	const target = $derived(auth.status === 'ready' ? guardTarget(page.url, auth.isLoggedIn) : null);

	// Session check once per app load (OF-18: authRefresh also extends the session).
	// untrack: the check must not run again when the session state changes.
	$effect(() => {
		void untrack(() => auth.restore());
	});

	// Redirects once no other navigation is running; the new URL is checked again. Login,
	// logout and changes from other tabs all end up here.
	$effect(() => {
		if (target === null || navigating.to !== null) return;
		// Narrowed to a resolved path, as svelte/no-navigation-without-resolve requires.
		const destination: ResolvedPathname = target;
		void goto(destination, { replaceState: true });
	});
</script>

<svelte:head>
	<title>becauseyoulovejira</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if auth.status === 'ready'}
	{#if target === null}
		{@render children()}
	{/if}
{:else if auth.status === 'unreachable'}
	<SessionNotice failure={auth.failure} busy={auth.busy} onretry={() => auth.restore()} />
{:else}
	<p class="checking" role="status">Sitzung wird geprüft …</p>
{/if}

<style>
	.checking {
		padding: 1.5rem;
		color: var(--color-text-muted);
		/* Only shown if the check takes noticeably long: no flash on a fast local server. */
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}
</style>
