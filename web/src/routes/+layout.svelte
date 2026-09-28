<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import '$lib/styles/prose.css';

	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import favicon from '$lib/assets/favicon.svg';
	import { auth } from '$lib/auth.svelte';
	import DuplicateTabNotice from '$lib/components/DuplicateTabNotice.svelte';
	import SessionNotice from '$lib/components/SessionNotice.svelte';
	import { guardTarget } from '$lib/guard';
	import {
		TAB_CHANNEL,
		TabPresence,
		currentNavigation,
		keepTab,
		setTabContext,
		shouldCheckForDuplicate
	} from '$lib/tab-presence';
	import { TitleBlinker } from '$lib/title-blink';

	let { children } = $props();

	// Second tab of the same browser and the blinking title (ADR-0035 sections 5 and 6), here so
	// they work on every page, the login included. The app layout shows the hint of another tab as
	// a flag; elsewhere the title only blinks. A tab opened from outside the app asks the others
	// first and answers them only once it stays.
	const blinker = new TitleBlinker(document, window);
	const tabs = new TabPresence(
		typeof BroadcastChannel === 'function' ? new BroadcastChannel(TAB_CHANNEL) : null
	);
	setTabContext({ tabs, blinker });
	let duplicate = $state(false);

	$effect(() =>
		untrack(() => {
			const removeFallback = tabs.onAttention(() => blinker.start());
			let active = true;
			if (shouldCheckForDuplicate(currentNavigation(window, document))) {
				void tabs.probe().then((found) => {
					if (!active) return;
					if (found) {
						tabs.notifyOthers();
						duplicate = true;
					} else {
						tabs.answer();
					}
				});
			} else {
				tabs.answer();
			}
			return () => {
				active = false;
				removeFallback();
				tabs.close();
				blinker.stop();
			};
		})
	);

	function keepThisTab() {
		keepTab(window);
		tabs.answer();
		duplicate = false;
	}

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

{#if duplicate}
	<DuplicateTabNotice onkeep={keepThisTab} />
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
