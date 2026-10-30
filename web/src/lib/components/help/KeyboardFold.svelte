<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';

	// A part of the help that only matters with a keyboard (MO-7c1, concept MO-0 §6 "Hilfe (Abschnitte
	// zur Tastatur am Handy eingeklappt)", ADR-0073 addendum MO-7c1): in the phone frame it is folded
	// into a native disclosure (details and summary), open on a tap of 44 px, so the long page starts
	// with what a finger needs; nothing goes away (principle of MO-0 §8). The heading before it stays a
	// heading of the page and the target of its jump link. On the PC and with the switch off the part
	// stands open as before, without the disclosure.
	let { label, children }: { label: string; children: Snippet } = $props();

	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);
</script>

{#if phone}
	<details class="keyboard-fold">
		<summary>{label}</summary>
		{@render children()}
	</details>
{:else}
	{@render children()}
{/if}

<style>
	/* Phone frame (MO-7c1): the summary is a target of 44 px; the content keeps the gaps of its section. */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .keyboard-fold {
			display: grid;
			gap: 0.625rem;
		}

		/* A list item keeps the triangle of the disclosure; the line height makes the target. */
		:global(:root[data-mobile-layout='on']) .keyboard-fold summary {
			min-height: var(--control-height-touch);
			font-size: var(--font-size-body);
			font-weight: 500;
			line-height: var(--control-height-touch);
			color: var(--color-brand-text);
			cursor: pointer;
		}
	}
</style>
