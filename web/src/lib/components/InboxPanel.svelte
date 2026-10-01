<script lang="ts">
	import { toDataError } from '$lib/data/errors';
	import { withConnectionName } from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		CHANNEL_LABELS,
		DISCARDED_CONTENT_NOTE,
		KIND_LABELS,
		metaText,
		stateLabel,
		sourceDateText,
		type InboxItem,
		type InboxItemSummary
	} from '$lib/domain/inbox';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { notionOriginText } from '$lib/domain/notion';
	import { itemSuggestion, suggestionFormValues } from '$lib/domain/rrule';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { findConnectionNames } from '$lib/stores/connection-names.svelte';
	import type { InboxStore } from '$lib/stores/inbox.svelte';
	import type { RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import {
		COPY_LABELS,
		canLeaveTicket,
		canSavePage,
		copiedFrom,
		copyCompleteness,
		copyNote,
		deletedTicketId,
		deletedTicketNote,
		isMainSource,
		pageCopyText
	} from '$lib/domain/sources';
	import { convertHref } from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import TrashNotice from './TrashNotice.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import LinkTicketDialog from './LinkTicketDialog.svelte';
	import Markdown from './Markdown.svelte';
	import MoveSourceDialog from './MoveSourceDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';

	// Panel of one inbox entry (E4 plan, package 3; ADR-0019 section 5): title, the details of the
	// source (kind, way, state, date at the sender, arrival, sender, place, chat, link), the text
	// (sanitised Markdown, ADR-0008), the hint on a possible duplicate with "Dem Ticket zuordnen",
	// the actions "Umwandeln", "Verwerfen", "Wiederherstellen" and "Originaldatei herunterladen",
	// and for a discarded entry the note that its content goes after 30 days (package 24). Links of
	// a source open only as http(s) (the hook refuses anything else). On the side panel building
	// block (ADR-0025 section 6): the actions stand in the fixed footer; × and Escape close.
	// A converted calendar series (E5 plan, package 6; ADR-0024 section 1) shows its rhythm with
	// "Wiederholung für TASK-12 anlegen…" while the ticket is open and in no series yet: the link
	// hands the suggested values to the recurrence store and opens the ticket, whose panel starts
	// "Wiederholen…" with them. A series the rules cannot express gets a neutral hint.
	// A converted or linked entry names its ticket at the top ("Gehört zu HAUS-12 · Titel", ADR-0031
	// addendum) with "Ticket öffnen", "Anderem Ticket zuordnen …" and "Lösen"; the main source of a
	// ticket keeps only "Ticket öffnen" and says why it stays. The copy of a source made for a
	// duplicate names the ticket it came from ("Kopie aus HAUS-12", ADR-0031 addendum F).
	let {
		id,
		store,
		openTickets,
		recurrence = null,
		today = null,
		sources = null,
		picker,
		onclose
	}: {
		id: string;
		store: InboxStore;
		/** Open tickets, for the hint on possible duplicates and the suggestion of a series. */
		openTickets: readonly TicketSummary[];
		/** Recurrence rules; without them (or before the E5 migration) no suggestion is shown. */
		recurrence?: RecurrenceStore | null;
		/** Berlin date of today, for the start of a suggested rule. */
		today?: CalendarDate | null;
		/** Linking to a ticket (ADR-0031); without it the panel offers no "Mit Ticket verknüpfen …". */
		sources?: TicketSourcesStore | null;
		/** Tickets of the picker (ADR-0042); the (app) layout provides them. */
		picker?: TicketPickerSource;
		/** × and Escape: back to the list with the chips of the URL. */
		onclose: () => void;
	} = $props();

	// Ticket links open the panel or the full view, as the user last chose (plan BI-1).
	const links = ticketLinks();

	const uid = $props.id();
	const headingId = `${uid}-title`;

	let loaded = $state<InboxItem | null>(null);
	let loadState = $state<'loading' | 'ready' | 'not_found' | 'error'>('loading');
	let loadError = $state<string | null>(null);
	let message = $state<string | null>(null);
	let downloading = $state(false);
	let linking = $state(false);
	let moving = $state(false);
	let savingPage = $state(false);
	let heading = $state<HTMLElement>();

	/** The loaded entry with the newest state of the store (realtime, own actions). */
	const item = $derived.by((): InboxItem | null => {
		if (loaded === null || loaded.id !== id) return null;
		const known = store.find(id);
		return known !== null && known.updated >= loaded.updated ? { ...loaded, ...known } : loaded;
	});
	/** What of the source the entry holds (ADR-0031 section 5), with a hint when it is not all. */
	const copy = $derived(item === null ? null : copyCompleteness(item));
	const note = $derived(item === null ? null : copyNote(item));
	/** The ticket of this source was deleted (ADR-0031, addendum B). */
	const ticketGone = $derived(item === null ? null : deletedTicketNote(item));
	/** The entry is the copy of a source made for a duplicate (ADR-0031, addendum F). */
	const copied = $derived(item === null ? null : copiedFrom(item));
	const duplicates = $derived(
		item !== null && item.state === 'new' ? store.softDuplicates(item, openTickets) : null
	);
	/** Open ticket of a converted entry that may still start a series, else null. */
	const seriesTicket = $derived.by((): TicketSummary | null => {
		if (item === null || item.state !== 'converted' || item.ticketId === null) return null;
		const ticket = openTickets.find((entry) => entry.id === item.ticketId);
		return ticket === undefined || ticket.recurring ? null : ticket;
	});
	const suggestion = $derived(
		seriesTicket === null ||
			item === null ||
			recurrence === null ||
			today === null ||
			recurrence.state === 'unavailable'
			? null
			: itemSuggestion(item, today)
	);
	// Names of the connections (ADR-0026, addendum KK-3); outside the (app) layout none.
	const connectionNames = findConnectionNames();
	const details = $derived.by((): [string, string][] => {
		if (item === null) return [];
		const rows: [string, string][] = [
			['Art', KIND_LABELS[item.kind]],
			[
				'Quelle',
				withConnectionName(
					CHANNEL_LABELS[item.channel],
					connectionNames?.nameOf(item.connectionId) ?? null
				)
			],
			['Zustand', stateLabel(item)],
			['Von', metaText(item, 'from') || metaText(item, 'sender')],
			['An', metaText(item, 'to')],
			['Ort', metaText(item, 'location')],
			['Chat', metaText(item, 'chat')],
			// Notion (ADR-0041): the page or database and the section above the point.
			['Aus', notionOriginText(item)],
			['Stichwort', metaText(item, 'keyword')],
			['Quelldatum', sourceDateText(item)],
			['Eingang', formatBerlinDateTime(item.created)],
			['Bearbeitet', item.handledAt === null ? '' : formatBerlinDateTime(item.handledAt)],
			['Seite gesichert', pageCopyText(item)]
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

	/** "Lösen" (ADR-0031 section 2): the entry goes back to the new ones; the store shows a flag. */
	async function release(entry: InboxItem) {
		if (sources === null) return;
		message = null;
		const result = await sources.release(entry);
		if (result.ok) update(result.value);
	}

	/** "Seiteninhalt sichern" (ADR-0031 section 6); afterwards the text is loaded again. */
	async function savePage(entry: InboxItem) {
		if (savingPage) return;
		savingPage = true;
		message = null;
		try {
			const result = await store.savePage(entry);
			if (!result.ok) {
				message = result.message;
				return;
			}
			const fresh = await store.fetch(entry.id);
			if (fresh.id === id) loaded = fresh;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind !== 'aborted') message = failure.message;
		} finally {
			savingPage = false;
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
			aria-busy={store.isPending(entry.id) ? 'true' : undefined}
			onclick={() => run(() => store.discard(entry.id))}>Verwerfen</button
		>
		{#if sources !== null}
			<button
				class="button-secondary"
				type="button"
				disabled={store.isPending(entry.id)}
				aria-busy={store.isPending(entry.id) ? 'true' : undefined}
				onclick={() => (linking = true)}>Mit Ticket verknüpfen …</button
			>
		{/if}
		<a class="button-primary entry-action" href={convertHref(entry.id)}>Umwandeln</a>
	{:else if entry.state === 'discarded'}
		<button
			class="button-secondary"
			type="button"
			disabled={store.isPending(entry.id)}
			aria-busy={store.isPending(entry.id) ? 'true' : undefined}
			onclick={() => run(() => store.restore(entry.id))}>Wiederherstellen</button
		>
	{/if}
{/snippet}

{#snippet belongsTo(entry: InboxItem, ticketId: string)}
	{@const ticket = entry.ticket?.id === ticketId ? entry.ticket : null}
	<section class="belongs" aria-labelledby={`${uid}-belongs`}>
		<p id={`${uid}-belongs`} class="belongs-line">
			{#if ticket !== null}
				Gehört zu <span class="key">{ticket.key}</span> · {ticket.title}
			{:else}
				Gehört zu einem Ticket
			{/if}
		</p>
		{#if ticket?.primary}
			<p class="belongs-note">
				Hauptquelle: Das Ticket ist aus diesem Eintrag entstanden. Er bleibt deshalb bei {ticket.key}
				und lässt sich weder lösen noch einem anderen Ticket zuordnen.
			</p>
		{/if}
		<div
			class="belongs-actions"
			aria-busy={sources !== null && sources.isPending(entry.id) ? 'true' : undefined}
		>
			<a class="button-secondary entry-action" href={links.path(ticketId)}>Ticket öffnen</a>
			{#if sources !== null && canLeaveTicket(entry, isMainSource(entry))}
				<button
					class="button-secondary"
					type="button"
					disabled={sources.isPending(entry.id)}
					onclick={() => (moving = true)}>Anderem Ticket zuordnen …</button
				>
				<button
					class="button-secondary"
					type="button"
					disabled={sources.isPending(entry.id)}
					onclick={() => void release(entry)}>Lösen</button
				>
			{/if}
		</div>
	</section>
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

		{#if item.state === 'converted' && item.ticketId !== null}
			{@render belongsTo(item, item.ticketId)}
		{/if}

		{#if copied !== null}
			<SectionMessage tone="info" compact>
				Kopie aus
				{#if copied.ticket !== null}
					<a href={links.path(copied.ticket)}>{copied.key}</a>{:else}{copied.key}{/if}: beim
				Duplizieren als eigener Eintrag angelegt; die Quelle des Originals ist unverändert.
			</SectionMessage>
		{/if}

		{#if ticketGone !== null}
			<SectionMessage tone="info" compact>{ticketGone}</SectionMessage>
			<!-- Since the trash (ADR-0037) the ticket may still be there. -->
			<TrashNotice id={deletedTicketId(item)} title="Das Ticket liegt im Papierkorb" />
		{/if}

		{#if item.state === 'discarded'}
			<SectionMessage tone="info" compact>{DISCARDED_CONTENT_NOTE}</SectionMessage>
		{/if}

		{#if note !== null && canSavePage(item)}
			<SectionMessage tone="info">
				{note}
				{#snippet actions()}
					<button
						class="button-secondary"
						type="button"
						aria-busy={savingPage ? 'true' : undefined}
						onclick={() => savePage(item)}
					>
						{savingPage ? 'Seite wird gesichert …' : 'Seiteninhalt sichern'}
					</button>
				{/snippet}
			</SectionMessage>
		{:else if note !== null}
			<SectionMessage tone="info" compact>{note}</SectionMessage>
		{/if}

		{#if duplicates !== null && (duplicates.tickets.length > 0 || duplicates.items.length > 0)}
			<div class="duplicate" role="note">
				<p><strong>Mögliches Duplikat.</strong> Gleicher Titel wie:</p>
				<ul>
					{#each duplicates.tickets as ticket (ticket.id)}
						<li>
							<a href={links.path(ticket.id)}>{ticket.key} {ticket.title}</a>
							<button
								class="text-button"
								type="button"
								disabled={store.isPending(item.id)}
								aria-busy={store.isPending(item.id) ? 'true' : undefined}
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
			{#if copy !== null}
				<div>
					<dt>Kopie</dt>
					<dd>
						<Lozenge
							label={COPY_LABELS[copy]}
							icon={copy === 'complete' ? 'check' : copy === 'too_large' ? 'warning' : 'info'}
							tone={copy === 'complete' ? 'brand' : 'neutral'}
						/>
					</dd>
				</div>
			{/if}
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
		{#if seriesTicket !== null && suggestion?.kind === 'rule'}
			{@const target = seriesTicket}
			{@const params = suggestion.params}
			<SectionMessage tone="info">
				Dieser Termin wiederholt sich: {suggestion.text}.
				{#each suggestion.notes as note (note)}
					{note}
				{/each}
				{#snippet actions()}
					<a
						class="button-secondary entry-action"
						href={links.path(target.id)}
						onclick={(event) => {
							// A new tab or window opens the ticket without the dialog.
							if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
							recurrence?.offerRepeat(target.id, suggestionFormValues(params));
						}}
					>
						Wiederholung für {target.key} anlegen…
					</a>
				{/snippet}
			</SectionMessage>
		{:else if seriesTicket !== null && suggestion?.kind === 'unsupported'}
			<SectionMessage tone="info">
				Diese Serie lässt sich nicht als Regel übernehmen ({suggestion.reasons.join('; ')}). Am
				Ticket {seriesTicket.key} kannst du „Wiederholen…“ wählen.
			</SectionMessage>
		{/if}

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

{#if linking && sources !== null && item !== null && item.state === 'new'}
	<LinkTicketDialog
		items={[{ id: item.id, title: item.title, scope: item.scope }]}
		store={sources}
		{picker}
		onclose={() => (linking = false)}
	/>
{/if}

{#if moving && sources !== null && item !== null && item.ticketId !== null && item.ticket}
	<MoveSourceDialog
		item={{ id: item.id, title: item.title, scope: item.scope }}
		current={{ id: item.ticketId, key: item.ticket.key }}
		store={sources}
		{picker}
		onmoved={update}
		onclose={() => (moving = false)}
	/>
{/if}

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
		border-radius: var(--radius-control);
	}

	/* The ticket of a converted or linked entry, marked in the accent colour (ADR-0031 addendum). */
	.belongs {
		display: grid;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		font-size: var(--font-size-control);
		background: var(--color-brand-soft-bg);
		color: var(--color-brand-soft-text);
		border-left: 3px solid var(--color-brand);
		border-radius: var(--radius-control);
	}

	.belongs-line {
		overflow-wrap: anywhere;
	}

	.key {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.belongs-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
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
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.text-button:disabled {
		cursor: not-allowed;
	}

	/* The entry is being changed (ADR-0026, addendum of 2026-09-30). */
	.text-button[aria-busy='true'] {
		cursor: progress;
	}
</style>
