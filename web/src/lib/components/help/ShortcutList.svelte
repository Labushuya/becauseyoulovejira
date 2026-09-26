<script lang="ts">
	import {
		SHORTCUT_CONTEXTS,
		shortcutsOf,
		type Shortcut,
		type ShortcutContext
	} from '$lib/domain/shortcuts';

	// Keyboard shortcuts of one or more contexts (plan EH-9, §3.10), from the one source
	// shortcuts.ts: per context a heading and a description list, keys in <kbd>, alternatives joined
	// by "oder". A description list instead of a table: it is no data list with a panel, so it falls
	// outside the column rules of table-columns.test.ts and wraps instead of scrolling sideways.
	let {
		contexts = SHORTCUT_CONTEXTS.map((context) => context.id),
		headingLevel = 3
	}: {
		/** Contexts to show, in the order of the help. */
		contexts?: readonly ShortcutContext[];
		headingLevel?: 3 | 4;
	} = $props();

	const uid = $props.id();

	const groups = $derived(
		SHORTCUT_CONTEXTS.filter((context) => contexts.includes(context.id)).map((context) => ({
			...context,
			shortcuts: shortcutsOf(context.id)
		}))
	);
</script>

{#snippet keys(shortcut: Shortcut)}
	{#each shortcut.keys as combination, index (index)}
		{#if index > 0}<span class="or">oder</span>{/if}
		<span class="combination">
			{#each combination as name, position (position)}
				{#if position > 0}<span class="plus">+</span>{/if}<kbd>{name}</kbd>
			{/each}
		</span>
	{/each}
{/snippet}

<div class="shortcut-list">
	{#each groups as group (group.id)}
		<section class="group" aria-labelledby={`${uid}-${group.id}`}>
			<svelte:element this={`h${headingLevel}`} id={`${uid}-${group.id}`} class="context">
				{group.label}
			</svelte:element>
			<dl>
				{#each group.shortcuts as shortcut (shortcut.id)}
					<div class="row">
						<dt>{@render keys(shortcut)}</dt>
						<dd>{shortcut.action}</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/each}
</div>

<style>
	.shortcut-list {
		display: grid;
		gap: 1rem;
	}

	.group {
		display: grid;
		gap: 0.375rem;
	}

	.context {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	dl {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	/* Keys and effect side by side; below about 28rem the effect wraps under the keys. */
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.375rem 0;
		font-size: 0.875rem;
		border-bottom: 1px solid var(--color-line);
	}

	dt {
		display: flex;
		flex: 0 0 11rem;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}

	dd {
		flex: 1 1 16rem;
	}

	.combination {
		display: inline-flex;
		gap: 0.125rem;
		align-items: center;
	}

	.or,
	.plus {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
