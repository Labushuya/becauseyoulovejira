<script lang="ts">
	import { describeHistoryEntry, withComments } from '$lib/domain/history-format';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { findPeople } from '$lib/stores/people.svelte';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';

	// History of the open ticket (E2 plan, T-10 and T-11): newest first, each entry with time in
	// Berlin, actor and a readable text. A changed description opens old and new text as plain
	// text, never as rendered Markdown. Project and tag names come from the catalog (E3 plan,
	// T-16); until it is loaded the history waits, so nothing shows as "(gelöscht)" by mistake. A
	// pinned comment is named by author and time while it is loaded (ADR-0044). Other accounts
	// appear with their name where it is visible (ADR-0056 §4, names of the (app) layout).
	let { store, catalog }: { store: TicketActivityStore; catalog: CatalogStore } = $props();

	const people = findPeople();
	const lookups = $derived({ ...withComments(catalog.lookups, store.comments), people });
	const lines = $derived(
		store.history.map((entry) => describeHistoryEntry(entry, lookups, store.userId))
	);
	const error = $derived(
		store.historyState === 'error'
			? store.historyError
			: catalog.state === 'error'
				? catalog.error
				: null
	);
	const loading = $derived(
		store.historyState === 'loading' ||
			(store.historyState === 'ready' && catalog.state !== 'ready')
	);

	async function retry() {
		await Promise.all([
			store.historyState === 'error' ? store.reloadHistory() : undefined,
			catalog.state === 'error' ? catalog.reload() : undefined
		]);
	}
</script>

{#if error}
	<div class="alert-error">
		<ErrorIcon />
		<span class="grow">{error}</span>
		<button class="retry" type="button" onclick={retry}>Erneut versuchen</button>
	</div>
{:else if loading}
	<p class="muted loading" role="status">Verlauf wird geladen …</p>
{:else if store.historyState === 'ready' && lines.length === 0}
	<EmptyState size="compact" title="Noch kein Verlauf" headingLevel={3} />
{:else}
	<ol class="history">
		{#each lines as line (line.id)}
			<li class="entry">
				<p class="head">
					<span class="actor">{line.actor}</span>
					<span class="time">{line.time}</span>
				</p>
				{#if line.details}
					<details>
						<summary>{line.text}</summary>
						<div class="versions">
							<p class="label">Vorher</p>
							<pre class="text">{line.details.before === '' ? '–' : line.details.before}</pre>
							<p class="label">Nachher</p>
							<pre class="text">{line.details.after === '' ? '–' : line.details.after}</pre>
						</div>
					</details>
				{:else}
					<p class="text-line">{line.text}</p>
				{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	.history {
		list-style: none;
	}

	.entry {
		display: grid;
		gap: 0.125rem;
		padding: 0.5rem 0;
		font-size: 0.8125rem;
		border-top: 1px solid var(--color-line);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		align-items: baseline;
	}

	.actor {
		font-weight: 600;
	}

	.time,
	.label,
	.muted {
		color: var(--color-text-muted);
	}

	.text-line {
		overflow-wrap: anywhere;
	}

	summary {
		cursor: pointer;
	}

	.versions {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.375rem;
	}

	.label {
		font-size: 0.75rem;
	}

	.text {
		max-height: 12rem;
		padding: 0.375rem 0.5rem;
		overflow: auto;
		font-size: 0.75rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-item);
	}

	.muted {
		font-size: 0.875rem;
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.retry {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.grow {
		flex: 1;
	}
</style>
