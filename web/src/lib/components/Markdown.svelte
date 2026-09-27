<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	// Rendered Markdown (ADR-0008). The only raw HTML output of the app; it shows nothing but the output
	// of renderMarkdown, which parses without raw HTML and sanitizes the result.
	let { source }: { source: string } = $props();

	const html = $derived(renderMarkdown(source));
</script>

<div class="markdown">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown (ADR-0008) -->
	{@html html}
</div>

<style>
	.markdown {
		min-width: 0;
		font-size: 0.875rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.markdown :global(:where(p, ul, ol, pre, blockquote, table, hr, h1, h2, h3, h4, h5, h6)) {
		margin-bottom: 0.625rem;
	}

	.markdown :global(:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(:where(h1, h2, h3, h4, h5, h6)) {
		font-weight: 600;
		line-height: 1.3;
	}

	.markdown :global(h1) {
		font-size: 1.25rem;
	}

	.markdown :global(h2) {
		font-size: 1.125rem;
	}

	.markdown :global(:where(h3, h4, h5, h6)) {
		font-size: 1rem;
	}

	.markdown :global(:where(ul, ol)) {
		padding-left: 1.5rem;
	}

	.markdown :global(a) {
		color: var(--color-brand-text);
	}

	.markdown :global(code) {
		padding: 0.0625rem 0.25rem;
		font-size: 0.8125rem;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-item);
	}

	.markdown :global(pre) {
		max-width: 100%;
		padding: 0.5rem 0.75rem;
		overflow-x: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.markdown :global(pre code) {
		padding: 0;
		background: none;
		border: none;
	}

	.markdown :global(blockquote) {
		padding-left: 0.75rem;
		color: var(--color-text-muted);
		border-left: 3px solid var(--color-line);
	}

	/* Wide tables from Markdown scroll inside their block instead of widening the panel. */
	.markdown :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
	}

	.markdown :global(:where(th, td)) {
		padding: 0.25rem 0.5rem;
		text-align: left;
		border: 1px solid var(--color-line);
	}

	.markdown :global(hr) {
		border: none;
		border-top: 1px solid var(--color-line);
	}
</style>
