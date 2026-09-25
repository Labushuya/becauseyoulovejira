<script lang="ts">
	import type { SettingsSection } from '$lib/settings-sections';

	// Navigation of the settings area (ADR-0026 section 1, plan EH-1): first the way back to the last
	// view, then one link per page. The pages have their own addresses, so these are links, not tabs;
	// the current one carries aria-current="page" and is marked by weight, surface and a line on the
	// left besides its colour. The small title "Einstellungen" is hidden from screen readers, because
	// the navigation has that name already.
	let {
		sections,
		current,
		backHref,
		backLabel
	}: {
		sections: readonly SettingsSection[];
		/** ID of the current page; null for none. */
		current: string | null;
		backHref: string;
		backLabel: string;
	} = $props();
</script>

<nav class="settings-nav" aria-label="Einstellungen">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- backHref is resolved and checked by LastViewStore -->
	<a class="back" href={backHref}>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M13 8H3.5M7.5 4L3.5 8l4 4" />
		</svg>
		{backLabel}
	</a>
	<p class="title" aria-hidden="true">Einstellungen</p>
	<ul>
		{#each sections as section (section.id)}
			<li>
				<a href={section.href} aria-current={section.id === current ? 'page' : undefined}>
					{section.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.settings-nav {
		display: grid;
		gap: 0.75rem;
		align-content: start;
		font-size: 0.875rem;
	}

	.back {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		justify-self: start;
		color: var(--color-brand-text);
		text-decoration: none;
	}

	.back:hover {
		text-decoration: underline;
	}

	.back svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.title {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	ul {
		display: grid;
		gap: 0.125rem;
		list-style: none;
	}

	ul a {
		display: block;
		padding: 0.375rem 0.75rem;
		color: var(--color-text);
		text-decoration: none;
		border-left: 3px solid transparent;
		border-radius: var(--radius-control);
	}

	ul a:hover {
		background: var(--color-surface);
	}

	ul a[aria-current='page'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-left-color: var(--color-brand);
	}

	/* Narrow: the pages become a wrapping line of links above the content. */
	@media (max-width: 63.99rem) {
		.title {
			display: none;
		}

		ul {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem;
		}

		ul a {
			border-bottom: 2px solid transparent;
			border-left: none;
		}

		ul a[aria-current='page'] {
			border-bottom-color: var(--color-brand);
		}
	}
</style>
