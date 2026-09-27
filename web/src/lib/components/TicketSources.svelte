<script lang="ts">
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import {
		COPY_LABELS,
		copyCompleteness,
		sourceChannelLabel,
		sourceOrigin,
		sourceWhen,
		type CopyCompleteness
	} from '$lib/domain/sources';
	import type { Ticket } from '$lib/domain/ticket';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { inboxItemHref } from '$lib/ticket-links';
	import AddSourcesDialog from './AddSourcesDialog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import MoveSourceDialog from './MoveSourceDialog.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import type { GuidanceIconName } from './guidance/GuidanceIcon.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Section "Quellen" of a ticket (ADR-0031 section 7), in the panel and the full view: every
	// inbox entry linked to the ticket with its channel, date, sender or chat or address, the main
	// source marked, and what its copy holds as lozenge. Per entry "Ansehen" (its panel in the
	// inbox), the original file and "Lösen" (not for the main source) as named icon buttons, so the
	// row fits the 480 px panel. "Quelle hinzufügen …" chooses new entries of the inbox.
	// "Anderem Ticket zuordnen …" (ADR-0031 addendum) moves an entry directly to another ticket;
	// the main source stays and says why.
	let {
		ticket,
		store,
		candidates
	}: {
		ticket: Pick<Ticket, 'id' | 'key' | 'sourceItem'>;
		store: TicketSourcesStore;
		/** New entries of the inbox for "Quelle hinzufügen …". */
		candidates: readonly InboxItemSummary[];
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let adding = $state(false);
	/** Entry of the dialog "Anderem Ticket zuordnen …", null while it is closed. */
	let moving = $state<Pick<InboxItemSummary, 'id' | 'title'> | null>(null);
	let message = $state<string | null>(null);

	const LOZENGES: Readonly<
		Record<CopyCompleteness, { icon: GuidanceIconName; tone: 'brand' | 'neutral' }>
	> = {
		complete: { icon: 'check', tone: 'brand' },
		text: { icon: 'info', tone: 'neutral' },
		address: { icon: 'info', tone: 'neutral' },
		too_large: { icon: 'warning', tone: 'neutral' }
	};

	const items = $derived(store.ticketId === ticket.id ? store.items : []);

	async function download(item: InboxItemSummary) {
		message = null;
		const result = await store.originalUrl(item);
		if (result.ok) window.location.assign(result.value);
		else message = result.message;
	}

	async function release(item: InboxItemSummary) {
		message = null;
		await store.release(item);
	}
</script>

<section class="sources" aria-labelledby={headingId}>
	<div class="head">
		<h3 id={headingId}>Quellen</h3>
		<button class="button-subtle" type="button" onclick={() => (adding = true)}>
			Quelle hinzufügen …
		</button>
	</div>

	<div aria-live="polite">
		{#if message}
			<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
		{/if}
	</div>

	{#if store.state === 'error' && store.ticketId === ticket.id}
		<SectionMessage tone="error" compact>
			{store.error}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.reload()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else if items.length === 0 && store.state !== 'ready'}
		<p class="hint" role="status">Quellen werden geladen …</p>
	{:else if items.length === 0}
		<EmptyState
			size="compact"
			title="Noch keine Quellen"
			description="Mails, Nachrichten oder Links aus dem Eingang lassen sich mit diesem Ticket verknüpfen."
		/>
	{:else}
		<ul class="list">
			{#each items as item (item.id)}
				{@const copy = copyCompleteness(item)}
				{@const origin = sourceOrigin(item)}
				{@const main = item.id === ticket.sourceItem}
				<li class="source">
					<div class="text">
						<p class="line">
							<span class="channel">{sourceChannelLabel(item)}</span>
							<span class="when">{sourceWhen(item)}</span>
							{#if main}
								<span class="main">Hauptquelle</span>
							{/if}
						</p>
						<p class="title">{item.title}</p>
						{#if origin !== ''}
							<p class="origin">{origin}</p>
						{/if}
						<Lozenge
							label={COPY_LABELS[copy]}
							icon={LOZENGES[copy].icon}
							tone={LOZENGES[copy].tone}
						/>
						{#if main}
							<p class="origin">
								Bleibt bei diesem Ticket, weil es aus ihr entstanden ist: kein Lösen, kein anderes
								Ticket.
							</p>
						{/if}
					</div>
					<div class="actions">
						<a class="view" href={inboxItemHref(item.id)} aria-label={`„${item.title}“ ansehen`}>
							Ansehen
						</a>
						{#if item.original !== ''}
							<button
								class="button-icon"
								type="button"
								aria-label={`Originaldatei von „${item.title}“ herunterladen`}
								title="Originaldatei herunterladen"
								onclick={() => void download(item)}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
								</svg>
							</button>
						{/if}
						{#if !main}
							<button
								class="button-icon"
								type="button"
								aria-label={`„${item.title}“ anderem Ticket zuordnen …`}
								title="Anderem Ticket zuordnen …"
								aria-disabled={store.isPending(item.id) ? 'true' : undefined}
								onclick={() => {
									if (!store.isPending(item.id)) moving = { id: item.id, title: item.title };
								}}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M2.5 8h10M9.5 4.5 13 8l-3.5 3.5" />
								</svg>
							</button>
							<button
								class="button-icon"
								type="button"
								aria-label={`„${item.title}“ lösen`}
								title="Lösen (zurück in den Eingang)"
								aria-disabled={store.isPending(item.id) ? 'true' : undefined}
								onclick={() => {
									if (!store.isPending(item.id)) void release(item);
								}}
							>
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<path
										d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1M2.5 2.5l2 2M11.5 11.5l2 2"
									/>
								</svg>
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if moving !== null}
	<MoveSourceDialog
		item={moving}
		current={{ id: ticket.id, key: ticket.key }}
		{store}
		onclose={() => (moving = null)}
	/>
{/if}

{#if adding}
	<AddSourcesDialog
		ticket={{ id: ticket.id, key: ticket.key }}
		{candidates}
		{store}
		onclose={() => (adding = false)}
	/>
{/if}

<style>
	.sources {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.list {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.source {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: start;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.text {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
		justify-items: start;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.channel,
	.main {
		font-weight: 600;
	}

	.title {
		font-size: var(--font-size-control);
		overflow-wrap: anywhere;
	}

	.origin {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.view {
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	.button-icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
