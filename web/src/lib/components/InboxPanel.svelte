<script lang="ts">
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
	import SectionMessage from './guidance/SectionMessage.svelte';
	import Markdown from './Markdown.svelte';
	import Drawer from './overlay/Drawer.svelte';

	// Panel of one inbox entry (E4 plan, package 3; ADR-0019 section 5): title, the details of the
	// source (kind, way, state, date at the sender, arrival, sender, place, chat, link), the text
	// (sanitised Markdown, ADR-0008), the hint on a possible duplicate with "Dem Ticket zuordnen",
	// the actions "Umwandeln", "Verwerfen", "Wiederherstellen" and "Originaldatei herunterladen",
	// and for a discarded entry the note that its content goes after 30 days (package 24). Links of
	// a source open only as http(s) (the hook refuses anything else). On the side panel building
	// block (ADR-0025 section 6): the actions stand in the fixed footer; × and Escape close.
	let {
		id,
		store,
		openTickets,
		onclose
	}: {
		id: string;
		store: InboxStore;
		/** Open tickets, for the hint on possible duplicates. */
		openTickets: readonly TicketSummary[];
		/** × and Escape: back to the list with the chips of the URL. */
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
</script>

{#snippet entryActions(entry: InboxItem)}
	{#if entry.original !== ''}
		<button
			class="button-secondary"
			type="button"
			aria-busy={downloading ? 'true' : undefined}
			onclick={() => download(entry)}>Originaldatei herunterladen</button
		>
	{/if}
	{#if entry.state === 'new'}
		<button
			class="button-secondary"
			type="button"
			disabled={store.isPending(entry.id)}
			onclick={() => run(() => store.discard(entry.id))}>Verwerfen</button
		>
		<a class="button-primary entry-action" href={convertHref(entry.id)}>Umwandeln</a>
	{:else if entry.state === 'discarded'}
		<button
			class="button-secondary"
			type="button"
			disabled={store.isPending(entry.id)}
			onclick={() => run(() => store.restore(entry.id))}>Wiederherstellen</button
		>
	{:else if entry.ticketId !== null}
		<a class="button-secondary entry-action" href={ticketPath(entry.ticketId)}>Ticket ansehen</a>
	{/if}
{/snippet}

<Drawer labelledby={headingId} closeFromFields {onclose}>
	{#snippet context()}Eintrag im Eingang{/snippet}
	{#snippet footer()}
		{#if item !== null}
			{@render entryActions(item)}
		{/if}
	{/snippet}

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

		{#if item.state === 'discarded'}
			<SectionMessage tone="info" compact>{DISCARDED_CONTENT_NOTE}</SectionMessage>
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
</Drawer>

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.entry-action {
		text-decoration: none;
	}

	.duplicate {
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
