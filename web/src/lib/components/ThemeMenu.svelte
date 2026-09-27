<script lang="ts">
	import {
		ACCENT_LABELS,
		ACCENT_THEMES,
		getAccentStore,
		type AccentStore
	} from '$lib/accent.svelte';
	import {
		getThemeStore,
		THEME_LABELS,
		THEME_PREFERENCES,
		type ThemePreference,
		type ThemeStore
	} from '$lib/theme.svelte';
	import { getTransparencyStore, type TransparencyStore } from '$lib/transparency.svelte';
	import Popover from './overlay/Popover.svelte';
	import ThemeIcon from './ThemeIcon.svelte';

	// Theme switcher in the header (ADR-0025 section 10, ADR-0027 section 6): an icon button with the
	// current mode in its name, opening a menu with two groups of menuitemradio: the mode ("Hell",
	// "Dunkel", "Wie System") and the color (Petrol, Rubin, Smaragd, Kupfer, each with its
	// swatch). A choice applies at once, stays on this device and reaches the other tabs. The page
	// "Darstellung" of the settings uses the same stores, lists and labels, so both always agree.
	// The switch "Transparenz" lives only on that page (ADR-0029 section 7); the menu, which is on
	// every page, connects its store, so a change reaches the other tabs at once.
	let {
		store = getThemeStore(),
		accentStore = getAccentStore(),
		transparencyStore = getTransparencyStore()
	}: {
		store?: ThemeStore;
		accentStore?: AccentStore;
		transparencyStore?: TransparencyStore;
	} = $props();

	const BUTTON_NAMES: Record<ThemePreference, string> = {
		light: 'Hell',
		dark: 'Dunkel',
		system: 'System'
	};

	$effect(() => store.connect());
	$effect(() => accentStore.connect());
	$effect(() => transparencyStore.connect());
</script>

{#snippet mark(checked: boolean)}
	<span class="mark" aria-hidden="true">
		{#if checked}
			<svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
				<path d="M3 8.5l3 3 7-7" />
			</svg>
		{/if}
	</span>
{/snippet}

<div class="theme-menu">
	<Popover
		kind="menu"
		label="Darstellung"
		placement="bottom-end"
		buttonClass="button-icon"
		buttonLabel={`Darstellung: ${BUTTON_NAMES[store.preference]}`}
	>
		{#snippet button()}
			<ThemeIcon preference={store.preference} />
		{/snippet}
		{#snippet children({ close })}
			<div role="group" aria-label="Modus">
				{#each THEME_PREFERENCES as preference (preference)}
					{@const checked = store.preference === preference}
					<button
						class="item"
						class:checked
						type="button"
						role="menuitemradio"
						aria-checked={checked}
						tabindex="-1"
						onclick={() => {
							store.choose(preference);
							close();
						}}
					>
						{@render mark(checked)}
						<ThemeIcon {preference} />
						{THEME_LABELS[preference]}
					</button>
				{/each}
			</div>
			<div role="separator"></div>
			<div role="group" aria-label="Farbe">
				<span class="group-label" aria-hidden="true">Farbe</span>
				{#each ACCENT_THEMES as accent (accent)}
					{@const checked = accentStore.accent === accent}
					<button
						class="item"
						class:checked
						type="button"
						role="menuitemradio"
						aria-checked={checked}
						tabindex="-1"
						onclick={() => {
							accentStore.choose(accent);
							close();
						}}
					>
						{@render mark(checked)}
						<span class="swatch" style:--swatch={`var(--swatch-${accent})`} aria-hidden="true"
						></span>
						{ACCENT_LABELS[accent]}
					</button>
				{/each}
			</div>
		{/snippet}
	</Popover>
</div>

<style>
	.theme-menu {
		display: inline-flex;
	}

	/* The check mark; the theme symbols style themselves. */
	.mark svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Rows, hover, focus and the separator come from the menu of Popover (ADR-0029 section 5). */
	.item {
		gap: 0.5rem;
	}

	/* The chosen entry: check mark and weight, never color alone (WCAG 1.4.1). */
	.item.checked {
		font-weight: 600;
	}

	.mark {
		display: inline-flex;
		width: 0.75rem;
	}

	.group-label {
		display: block;
		padding: 0.25rem 0.5rem 0.125rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	/* The accent of a theme in the current mode, from tokens.css; a line keeps it apart. */
	.swatch {
		width: 1rem;
		height: 1rem;
		background: var(--swatch);
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}
</style>
