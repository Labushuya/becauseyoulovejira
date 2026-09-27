<script lang="ts">
	import type { SettingsSection } from '$lib/settings-sections';

	// Navigation of the settings area (ADR-0026 section 1, plan EH-1): first the way back to the last
	// view, then one link per page. The pages have their own addresses, so these are links, not tabs;
	// the current one carries aria-current="page" and is marked by weight and surface besides its
	// colour. From 64rem it is a floating glass card (ADR-0029, G-6). The small title "Einstellungen" is hidden from screen readers, because
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
		font-size: var(--font-size-body);
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
		font-size: var(--font-size-caption);
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
		display: flex;
		align-items: center;
		min-height: var(--control-height-m);
		padding: 0.25rem 0.75rem;
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-control);
	}

	ul a:hover {
		background: var(--fill-control-hover);
	}

	/* The current page: accent surface and weight, never colour alone (ADR-0010 section 3). */
	ul a[aria-current='page'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	/*
	 * From 64rem a floating sidebar card as in the macOS system settings (ADR-0029 section 1):
	 * regular glass over the background gradient, which is all that lies behind it (the column
	 * stays sticky, the page scrolls on the right). Rows as rounded surfaces instead of a line.
	 */
	@media (min-width: 64rem) {
		.settings-nav {
			padding: 0.75rem 0.5rem;
			background: var(--material-regular);
			backdrop-filter: var(--glass-filter-regular);
			border: 1px solid var(--color-separator);
			border-radius: var(--radius-overlay);
			box-shadow:
				inset 0 1px 0 var(--glass-edge),
				var(--shadow-popover);
		}

		.back,
		.title {
			margin-inline: 0.75rem;
		}
	}

	/*
	 * Narrow: the pages become a wrapping line of links above the content, without glass; the
	 * current one also carries a line below (the accent as text, 3 : 1 on the gradient).
	 */
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
			border-radius: var(--radius-control) var(--radius-control) 0 0;
		}

		ul a[aria-current='page'] {
			border-bottom-color: var(--color-brand-text);
		}
	}
</style>
