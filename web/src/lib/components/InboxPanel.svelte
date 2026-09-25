<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { toDataError } from '$lib/data/errors';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		CHANNEL_LABELS,
		DISCARDED_CONTENT_NOTE,
		KIND_LABELS,
		STATE_LABELS,
		metaText,
		sourceDateText,
		type InboxItem,
		type InboxItemSummary
	} from '$lib/domain/inbox';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { InboxStore } from '$lib/stores/inbox.svelte';
	import { convertHref, ticketPath } from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';

	// Panel of one inbox entry (E4 plan, package 3; ADR-0019 section 5): title, the details of the
	// source (kind, way, state, date at the sender, arrival, sender, place, chat, link), the text
	// (sanitised Markdown, ADR-0008), the hint on a possible duplicate with "Dem Ticket zuordnen",
	// the actions "Umwandeln", "Verwerfen", "Wiederherstellen" and "Originaldatei herunterladen",
	// and for a discarded entry the note that its content goes after 30 days (package 24). Links of
	// a source open only as http(s) (the hook refuses anything else). Escape closes the panel.
	let {
		id,
		store,
		openTickets,
		closeHref,
		onclose
	}: {
		id: string;
		store: InboxStore;
		/** Open tickets, for the hint on possible duplicates. */
		openTickets: readonly TicketSummary[];
		/** Link back to the list with the chips of the URL. */
		closeHref: ResolvedPathname;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-title`;

	let loaded = $state<InboxItem | null>(null);
	let loadState = $state<'loading' | 'ready' | 'not_found' | 'error'>('loading');
	let loadError = $state<string | null>(null);
	let message = $state<string | null>(null);
	let downloading = $state(false);
	let heading = $state<HTMLElement>();

	/** The loaded entry with the newest state of the store (realtime, own actions). */
	const item = $derived.by((): InboxItem | null => {
		if (loaded === null || loaded.id !== id) return null;
		const known = store.find(id);
		return known !== null && known.updated >= loaded.updated ? { ...loaded, ...known } : loaded;
	});
	const duplicates = $derived(
		item !== null && item.state === 'new' ? store.softDuplicates(item, openTickets) : null
	);
	const details = $derived.by((): [string, string][] => {
		if (item === null) return [];
		const rows: [string, string][] = [
			['Art', KIND_LABELS[item.kind]],
			['Quelle', CHANNEL_LABELS[item.channel]],
			['Zustand', STATE_LABELS[item.state]],
			['Von', metaText(item, 'from') || metaText(item, 'sender')],
			['An', metaText(item, 'to')],
			['Ort', metaText(item, 'location')],
			['Chat', metaText(item, 'chat')],
			['Stichwort', metaText(item, 'keyword')],
			['Quelldatum', sourceDateText(item)],
			['Eingang', formatBerlinDateTime(item.created)],
			['Bearbeitet', item.handledAt === null ? '' : formatBerlinDateTime(item.handledAt)]
		];
		return rows.filter(([, value]) => value !== '');
	});

	$effect(() => {
		const current = id;
		const controller = new AbortController();
		loadState = 'loading';
		loadError = null;
		message = null;
		store.fetch(current, { signal: controller.signal }).then(
			(entry) => {
				if (controller.signal.aborted) return;
				loaded = entry;
				loadState = 'ready';
				queueMicrotask(() => heading?.focus());
			},
			(error: unknown) => {
				if (controller.signal.aborted) return;
				const failure = toDataError(error);
				if (failure.kind === 'aborted') return;
				loadState = failure.kind === 'not_found' ? 'not_found' : 'error';
				loadError = failure.message;
			}
		);
		return () => controller.abort();
	});

	function update(entry: InboxItemSummary) {
		if (loaded !== null && loaded.id === entry.id) loaded = { ...loaded, ...entry };
	}

	async function run(
		action: () => Promise<
			{ ok: true; item: InboxItemSummary } | { ok: false; message: string | null }
		>
	) {
		message = null;
		const result = await action();
		if (result.ok) update(result.item);
		else message = result.message;
	}

	async function download(entry: InboxItem) {
		if (downloading) return;
		downloading = true;
		message = null;
		try {
			const result = await store.originalUrl(entry);
			if (result.ok) window.location.assign(result.url);
			else message = result.message;
		} finally {
			downloading = false;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		onclose();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="side-panel" aria-labelledby={headingId} {onkeydown}>
	<div class="bar">
		<span class="bar-label">Eintrag im Eingang</span>
		<a class="close" href={closeHref}>Schließen</a>
	</div>

	{#if loadState === 'not_found'}
		<h2 id={headingId} tabindex="-1">Eintrag nicht gefunden</h2>
		<p>Der Eintrag wurde gelöscht oder ist nicht sichtbar.</p>
	{:else if loadState === 'error'}
		<h2 id={headingId} tabindex="-1">Eintrag</h2>
		<p class="alert-error"><ErrorIcon /><span>{loadError}</span></p>
	{:else if item === null}
		<p class="loading" role="status">Eintrag wird geladen …</p>
	{:else}
		<h2 id={headingId} tabindex="-1" bind:this={heading}>{item.title}</h2>

		<div aria-live="polite">
			{#if message}
				<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
			{/if}
		</div>

		<div class="actions">
			{#if item.state === 'new'}
				<a class="button-primary" href={convertHref(item.id)}>Umwandeln</a>
				<button
					class="secondary"
					type="button"
					disabled={store.isPending(item.id)}
					onclick={() => run(() => store.discard(item.id))}>Verwerfen</button
				>
			{:else if item.state === 'discarded'}
				<button
					class="secondary"
					type="button"
					disabled={store.isPending(item.id)}
					onclick={() => run(() => store.restore(item.id))}>Wiederherstellen</button
				>
			{:else if item.ticketId !== null}
				<a class="secondary" href={ticketPath(item.ticketId)}>Ticket ansehen</a>
			{/if}
			{#if item.original !== ''}
				<button
					class="secondary"
					type="button"
					aria-busy={downloading ? 'true' : undefined}
					onclick={() => download(item)}>Originaldatei herunterladen</button
				>
			{/if}
		</div>

		{#if item.state === 'discarded'}
			<p class="hint">{DISCARDED_CONTENT_NOTE}</p>
		{/if}

		{#if duplicates !== null && (duplicates.tickets.length > 0 || duplicates.items.length > 0)}
			<div class="duplicate" role="note">
				<p><strong>Mögliches Duplikat.</strong> Gleicher Titel wie:</p>
				<ul>
					{#each duplicates.tickets as ticket (ticket.id)}
						<li>
							<a href={ticketPath(ticket.id)}>{ticket.key} {ticket.title}</a>
							<button
								class="text-button"
								type="button"
								disabled={store.isPending(item.id)}
								onclick={() => run(() => store.assign(item.id, ticket.id, ticket.key))}
							>
								Dem Ticket {ticket.key} zuordnen
							</button>
						</li>
					{/each}
					{#each duplicates.items as other (other.id)}
						<li>anderer Eintrag „{other.title}“ im Eingang</li>
					{/each}
				</ul>
			</div>
		{/if}

		<dl class="meta">
			{#each details as [label, value] (label)}
				<div>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			{/each}
			{#if item.sourceUrl !== ''}
				<div>
					<dt>Link</dt>
					<dd>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link of the source, http(s) only (checked by the hook) -->
						<a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceUrl}</a>
					</dd>
				</div>
			{/if}
		</dl>
		{#if item.sourceDate !== null}
			<p class="hint">
				Das Quelldatum wird nicht zur Fälligkeit. Beim Umwandeln lässt es sich per Knopf übernehmen.
			</p>
		{/if}

		<section class="body" aria-label="Text">
			{#if item.body.trim() === ''}
				<p class="hint">Kein Text.</p>
			{:else}
				<Markdown source={item.body} />
			{/if}
		</section>
	{/if}
</aside>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.bar-label {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.close {
		font-size: 0.8125rem;
		color: var(--color-brand-text);
	}

	h2 {
		margin-bottom: 0.75rem;
		font-size: 1.125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.actions a {
		text-decoration: none;
	}

	.secondary {
		padding: 0.5rem 0.875rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.secondary:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.duplicate {
		margin-bottom: 1rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		border: 1px solid var(--color-line);
		border-left: 3px solid var(--color-brand);
		border-radius: 0.375rem;
	}

	.duplicate ul {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.25rem;
		padding-left: 1rem;
	}

	.duplicate a {
		color: var(--color-brand-text);
	}

	.meta {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
		font-size: 0.8125rem;
	}

	.meta div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		overflow-wrap: anywhere;
	}

	dd a {
		color: var(--color-brand-text);
	}

	.hint,
	.loading {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.body {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-line);
	}

	.text-button {
		margin-left: 0.5rem;
		padding: 0.0625rem 0.5rem;
		font-size: 0.75rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
