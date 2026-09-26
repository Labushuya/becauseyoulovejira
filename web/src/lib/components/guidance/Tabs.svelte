<script lang="ts" generics="T extends string">
	import type { Snippet } from 'svelte';
	import { tabTarget } from '$lib/guidance/tabs';

	// Tabs inside a step of the assistant (WAI-ARIA APG "Tabs" with manual activation, plan EH-5
	// §3.11): a tab list with a name, arrow keys move the focus in a circle, Home and End go to the
	// ends (roving tabindex), Enter, Space or a click select. Each tab controls its panel, which is
	// named by the tab and reachable with Tab (tabindex 0). Only the selected panel has content.
	// Not an overlay.
	let {
		label,
		tabs,
		selected,
		onselect,
		panel
	}: {
		/** Name of the tab list. */
		label: string;
		tabs: readonly { id: T; label: string }[];
		selected: T;
		onselect: (id: T) => void;
		/** Content of the selected panel. */
		panel: Snippet<[T]>;
	} = $props();

	const uid = $props.id();
	const tabId = (id: T) => `${uid}-tab-${id}`;
	const panelId = (id: T) => `${uid}-panel-${id}`;

	/** Tab that holds the roving focus; it follows the selection until the arrows move it. */
	let focused = $state<T | null>(null);
	const current = $derived(focused ?? selected);
	const buttons: Partial<Record<string, HTMLButtonElement>> = $state({});

	function onkeydown(event: KeyboardEvent) {
		const index = tabs.findIndex((tab) => tab.id === current);
		const target = tabTarget(event.key, index, tabs.length);
		const tab = target === null ? undefined : tabs[target];
		if (tab === undefined) return;
		event.preventDefault();
		focused = tab.id;
		buttons[tab.id]?.focus();
	}

	function choose(id: T) {
		focused = null;
		onselect(id);
	}
</script>

<div class="tabs">
	<div class="list" role="tablist" aria-label={label}>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id={tabId(tab.id)}
				aria-selected={selected === tab.id}
				aria-controls={panelId(tab.id)}
				tabindex={current === tab.id ? 0 : -1}
				bind:this={buttons[tab.id]}
				onclick={() => choose(tab.id)}
				onblur={() => {
					if (focused === tab.id) focused = null;
				}}
				{onkeydown}
			>
				{tab.label}
			</button>
		{/each}
	</div>
	{#each tabs as tab (tab.id)}
		<div
			class="panel"
			role="tabpanel"
			id={panelId(tab.id)}
			aria-labelledby={tabId(tab.id)}
			tabindex="0"
			hidden={selected !== tab.id}
		>
			{#if selected === tab.id}
				{@render panel(tab.id)}
			{/if}
		</div>
	{/each}
</div>

<style>
	.tabs {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-line);
	}

	[role='tab'] {
		margin-bottom: -1px;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}

	[role='tab']:hover {
		color: var(--color-text);
	}

	/* The selected tab: text colour, weight and the line, not colour alone. */
	[role='tab'][aria-selected='true'] {
		font-weight: 600;
		color: var(--color-text);
		border-bottom-color: var(--color-brand);
	}

	.panel {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.panel[hidden] {
		display: none;
	}
</style>
