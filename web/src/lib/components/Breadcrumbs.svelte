<script lang="ts">
	// Breadcrumbs (ADR-0026 section 1, APG breadcrumb pattern): a named navigation with an ordered
	// list. Every step but the last is a link; the last one is the current page with
	// aria-current="page". The separator is a CSS pseudo element, so screen readers do not read it.
	let { items }: { items: readonly { label: string; href?: string }[] } = $props();
</script>

<nav class="breadcrumbs" aria-label="Brotkrumenpfad">
	<ol>
		{#each items as item, index (index)}
			<li>
				{#if index < items.length - 1 && item.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the callers pass resolved addresses -->
					<a href={item.href}>{item.label}</a>
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
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		list-style: none;
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
