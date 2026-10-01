<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isHttpsUrl } from '$lib/guidance/links';
	import NewTabHint from './NewTabHint.svelte';

	// Link to a page of a provider (ADR-0026 section 6, plan EH-4): only fixed https addresses, in a
	// new tab without opener and referrer, with an icon "outside" and a hidden " (öffnet in neuem
	// Tab)" (NewTabHint, with its space). An address that is not https is not linked; its text stays.
	let { href, children }: { href: string; children: Snippet } = $props();

	const safe = $derived(isHttpsUrl(href));
</script>

{#if safe}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external https page, not a route of the app -->
	<a class="external" {href} target="_blank" rel="noopener noreferrer"
		>{@render children()}<svg
			viewBox="0 0 16 16"
			width="12"
			height="12"
			aria-hidden="true"
			focusable="false"><path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5v3.5h-8.5v-8.5h3.5" /></svg
		><NewTabHint /></a
	>
{:else}
	<span class="external">{@render children()}</span>
{/if}

<style>
	.external {
		color: var(--color-brand-text);
	}

	svg {
		margin-left: 0.25rem;
		vertical-align: -0.0625rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
