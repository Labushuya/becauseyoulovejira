<script lang="ts">
	import {
		getThemeStore,
		THEME_LABELS,
		THEME_PREFERENCES,
		type ThemePreference,
		type ThemeStore
	} from '$lib/theme.svelte';
	import Popover from './overlay/Popover.svelte';
	import ThemeIcon from './ThemeIcon.svelte';

	// Theme switcher in the header (ADR-0025 section 10): an icon button with the current mode in
	// its name, opening a menu with "Hell", "Dunkel" and "Wie System" (menuitemradio). The choice
	// applies at once, stays on this device and reaches the other tabs. The page "Darstellung" of
	// the settings (EH-8) uses the same store, labels and icons, so both always show the same choice.
	let { store = getThemeStore() }: { store?: ThemeStore } = $props();

	const BUTTON_NAMES: Record<ThemePreference, string> = {
		light: 'Hell',
		dark: 'Dunkel',
		system: 'System'
	};

	$effect(() => store.connect());
</script>

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
					<span class="mark" aria-hidden="true">
						{#if checked}
							<svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
								<path d="M3 8.5l3 3 7-7" />
							</svg>
						{/if}
					</span>
					<ThemeIcon {preference} />
					{THEME_LABELS[preference]}
				</button>
			{/each}
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

	.item {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.item:hover,
	.item:focus-visible {
		background: var(--color-bg);
	}

	/* The chosen entry: check mark and weight, never color alone (WCAG 1.4.1). */
	.item.checked {
		font-weight: 600;
	}

	.mark {
		display: inline-flex;
		width: 0.75rem;
	}
</style>
