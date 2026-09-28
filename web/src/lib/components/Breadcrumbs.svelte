<script lang="ts">
	// Breadcrumbs (ADR-0026 section 1, APG breadcrumb pattern): a named navigation with an ordered
	// list. Every step but the last is a link; the last one is the current page with
	// aria-current="page". The separator is a CSS pseudo element, so screen readers do not read it.
	// The path of a sub-task (ADR-0033, "HAUS-12 › HAUS-15") uses it with its own name, keys in the
	// mono font and the title of the parent as tooltip.
	let {
		items,
		label = 'Brotkrumenpfad',
		mono = false
	}: {
		items: readonly { label: string; href?: string; title?: string }[];
		/** Name of the navigation. */
		label?: string;
		/** Steps in the mono font (ticket keys). */
		mono?: boolean;
	} = $props();
</script>

<nav class="breadcrumbs" class:mono aria-label={label}>
	<ol>
		{#each items as item, index (index)}
			<li>
				{#if index < items.length - 1 && item.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the callers pass resolved addresses -->
					<a href={item.href} title={item.title || undefined}>{item.label}</a>
				{:else}
					<span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>

<style>
	ol {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		list-style: none;
	}

	.mono ol {
		font-family: var(--font-mono);
	}

	li + li::before {
		margin-right: 0.25rem;
		/* Empty alternative text: the separator is decoration only. */
		content: '›' / '';
	}

	a {
		color: var(--color-brand-text);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
