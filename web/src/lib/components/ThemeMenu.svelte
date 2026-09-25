<script lang="ts">
	import {
		getThemeStore,
		THEME_LABELS,
		THEME_PREFERENCES,
		type ThemePreference,
		type ThemeStore
	} from '$lib/theme.svelte';
	import Popover from './overlay/Popover.svelte';

	// Theme switcher in the header (ADR-0025 section 10): an icon button with the current mode in
	// its name, opening a menu with "Hell", "Dunkel" and "Wie System" (menuitemradio). The choice
	// applies at once, stays on this device and reaches the other tabs.
	let { store = getThemeStore() }: { store?: ThemeStore } = $props();

	const BUTTON_NAMES: Record<ThemePreference, string> = {
		light: 'Hell',
		dark: 'Dunkel',
		system: 'System'
	};

	$effect(() => store.connect());
</script>

{#snippet icon(preference: ThemePreference)}
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
		{#if preference === 'light'}
			<circle cx="8" cy="8" r="2.75" />
			<path
				d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"
			/>
		{:else if preference === 'dark'}
			<path d="M13 9.6A5.25 5.25 0 0 1 6.4 3a5.25 5.25 0 1 0 6.6 6.6Z" />
		{:else}
			<rect x="2" y="2.75" width="12" height="8.5" rx="1" />
			<path d="M6 14h4M8 11.25V14" />
		{/if}
	</svg>
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
			{@render icon(store.preference)}
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
					{@render icon(preference)}
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

	svg {
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
