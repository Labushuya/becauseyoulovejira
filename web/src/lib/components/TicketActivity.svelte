<script lang="ts">
	import type { CommentPinControl } from '$lib/domain/comments';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import CommentList from './CommentList.svelte';
	import HistoryList from './HistoryList.svelte';

	// Activity below the ticket fields (E2 plan, T-11): tabs "Kommentare" (selected first) and
	// "Verlauf" after the WAI-ARIA tabs pattern with automatic activation. Both panels stay in
	// the DOM, so switching keeps a comment being written. `pin` is the ticket's way to pin a
	// comment (ADR-0044), the detail store in panel and full view.
	let {
		store,
		catalog,
		pin = null
	}: {
		store: TicketActivityStore;
		catalog: CatalogStore;
		pin?: CommentPinControl | null;
	} = $props();

	type Tab = 'comments' | 'history';
	const TABS: readonly { id: Tab; label: string }[] = [
		{ id: 'comments', label: 'Kommentare' },
		{ id: 'history', label: 'Verlauf' }
	];

	const uid = $props.id();
	const tabId = (tab: Tab) => `${uid}-tab-${tab}`;
	const panelId = (tab: Tab) => `${uid}-panel-${tab}`;

	let selected = $state<Tab>('comments');
	const tabs: Partial<Record<Tab, HTMLButtonElement>> = $state({});
	let commentsPanel = $state<HTMLElement>();

	function select(tab: Tab) {
		selected = tab;
		tabs[tab]?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const index = TABS.findIndex((tab) => tab.id === selected);
		const last = TABS.length - 1;
		const next: Record<string, number> = {
			ArrowRight: index === last ? 0 : index + 1,
			ArrowLeft: index === 0 ? last : index - 1,
			Home: 0,
			End: last
		};
		const target = next[event.key];
		const tab = target === undefined ? undefined : TABS[target];
		if (tab === undefined) return;
		event.preventDefault();
		select(tab.id);
	}
</script>

<div class="activity">
	<div class="tabs" role="tablist" aria-label="Aktivität">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id={tabId(tab.id)}
				aria-selected={selected === tab.id}
				aria-controls={panelId(tab.id)}
				tabindex={selected === tab.id ? 0 : -1}
				bind:this={tabs[tab.id]}
				onclick={() => select(tab.id)}
				{onkeydown}
			>
				{tab.label}
				{#if tab.id === 'comments' && store.comments.length > 0}
					<span class="count">{store.comments.length}</span>
				{/if}
			</button>
		{/each}
	</div>

	<div
		class="panel"
		role="tabpanel"
		id={panelId('comments')}
		aria-labelledby={tabId('comments')}
		tabindex="-1"
		hidden={selected !== 'comments'}
		data-ticket-option="comments"
		bind:this={commentsPanel}
	>
		<CommentList {store} {pin} ondeleted={() => commentsPanel?.focus()} />
	</div>
	<div
		class="panel"
		role="tabpanel"
		id={panelId('history')}
		aria-labelledby={tabId('history')}
		tabindex="0"
		hidden={selected !== 'history'}
		data-ticket-option="history"
	>
		<HistoryList {store} {catalog} />
	</div>
</div>

<style>
	.activity {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-line);
	}

	[role='tab'] {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		margin-bottom: -1px;
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}

	[role='tab'][aria-selected='true'] {
		font-weight: 600;
		color: var(--color-text);
		border-bottom-color: var(--color-brand);
	}

	.count {
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-pill);
	}

	.panel:focus {
		outline: none;
	}

	.panel:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}
</style>
