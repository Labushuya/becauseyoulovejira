<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import {
		CHANNEL_LABELS,
		KIND_LABELS,
		STATE_LABELS,
		type InboxItemSummary,
		type InboxState
	} from '$lib/domain/inbox';
	import { type InboxQuery } from '$lib/domain/inbox-query';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import { SOURCE_FAMILY_CHIPS, SOURCE_FAMILY_LABELS, type SourceFamily } from '$lib/domain/source';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { INBOX_UNAVAILABLE_MESSAGE, type InboxStore } from '$lib/stores/inbox.svelte';
	import {
		captureHref,
		convertHref,
		inboxItemHref,
		ticketPath,
		withInboxQuery
	} from '$lib/ticket-links';
	import ChipGroup from './ChipGroup.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import SectionBar from './SectionBar.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Inbox view (E4 plan, package 3; ADR-0014 sections 3 and 4; ADR-0019 section 6): section bar
	// "Eingang" with the switch and "Gesammelt umwandeln", the chips "Quelle" and "Zustand" (state
	// of the URL), and the table: selection, kind, title (link to the panel) with the hint on a
	// possible duplicate, source, date at the sender, arrival and the actions. New entries are
	// shown newest first, handled ones most recently handled first with "Weitere laden".
	// "Verwerfen" removes the row at once ("Rückgängig" stands in the flag of the store) and moves
	// the focus to the next row; a failed row action becomes an error flag (ADR-0025 section 8).
	// The date at the sender is only shown, never taken as due date (P-5). The table never scrolls
	// sideways (package UI-6b): in a narrow frame container queries hide columns in a fixed order,
	// first the arrival (or handling) date, then "Quelle", then "Art", last "Quelldatum"; selection,
	// title and the actions always stay, and the caption then names the panel.
	let {
		store,
		flags,
		openTickets,
		activeId = null,
		selected = $bindable([]),
		projectsNewCount = 0,
		clipboardHint = null,
		onclipboard,
		onbulk,
		tools,
		actions
	}: {
		store: InboxStore;
		/** Flags of the app, for failed row actions. */
		flags: FlagSink;
		/** Open tickets of the list store, for the hint on possible duplicates. */
		openTickets: readonly TicketSummary[];
		/** Entry shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** IDs of the chosen new entries. */
		selected?: string[];
		/** New tickets in projects, for the switch (ADR-0015 section 5). */
		projectsNewCount?: number;
		/** "Gesammelt umwandeln" for the chosen entries. */
		onbulk: () => void;
		/** "Aus Zwischenablage" (E4 plan, package 6); without it there is no button. */
		onclipboard?: () => void;
		/** Why the clipboard could not be read, with the way through Ctrl+V; neutral, no error. */
		clipboardHint?: string | null;
		/** Further ways into the inbox under the chips (drop zone for files, package 8). */
		tools?: Snippet;
		/** First actions of the section bar ("Alle Kanäle jetzt abrufen", package A item 4). */
		actions?: Snippet;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		caption: `${uid}-caption`,
		bulkHint: `${uid}-bulk-hint`
	};

	const STATE_CHIPS: readonly { value: InboxState; label: string }[] = [
		{ value: 'new', label: STATE_LABELS.new },
		{ value: 'discarded', label: STATE_LABELS.discarded },
		{ value: 'converted', label: STATE_LABELS.converted }
	];
	const SOURCE_CHIPS = SOURCE_FAMILY_CHIPS.map((family) => ({
		value: family,
		label: SOURCE_FAMILY_LABELS[family]
	}));

	const query = $derived(store.query);
	const showsNew = $derived(query.state === 'new');
	const rows = $derived(store.visible);
	/** Chosen entries that are shown and still new (a converted or discarded one drops out). */
	const chosen = $derived(
		rows.filter((item) => item.state === 'new' && selected.includes(item.id))
	);
	const selectable = $derived(rows.filter((item) => item.state === 'new'));
	const allChosen = $derived(selectable.length > 0 && chosen.length === selectable.length);
	const ready = $derived(
		showsNew ? store.state === 'ready' : store.state === 'ready' && store.handledLoad === 'ready'
	);
	const unavailable = $derived(store.state === 'error' && store.error !== null);
	const countLabel = $derived(
		rows.length === 1 ? '1 Eintrag' : `${rows.length}${store.handledHasMore ? '+' : ''} Einträge`
	);
	const caption = $derived(
		showsNew
			? 'Eingang · neu, neueste zuerst'
			: query.state === 'discarded'
				? 'Eingang · verworfen, zuletzt verworfene zuerst'
				: 'Eingang · umgewandelt, zuletzt umgewandelte zuerst'
	);

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	/** Failure of a row action (discard, restore, assign) as an error flag; it stays until closed. */
	function fail(message: string | null | undefined) {
		if (message) flags.show({ tone: 'error', title: message });
	}

	async function navigate(next: InboxQuery) {
		await goto(withInboxQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	async function clearSource() {
		await navigate({ ...query, source: null });
		heading?.focus();
	}

	function toggle(id: string, on: boolean) {
		selected = on
			? [...selected.filter((entry) => entry !== id), id]
			: selected.filter((entry) => entry !== id);
	}

	function toggleAll(on: boolean) {
		selected = on ? selectable.map((item) => item.id) : [];
	}

	function titleLinks(): HTMLElement[] {
		return [...(root?.querySelectorAll<HTMLElement>('tbody tr[data-item-id] a.title-link') ?? [])];
	}

	/** After "Verwerfen" the focus goes to the next row, else the previous one, else the heading. */
	async function discard(item: InboxItemSummary) {
		const before = titleLinks();
		const index = before.findIndex((link) => link.closest('tr')?.dataset.itemId === item.id);
		const result = await store.discard(item.id);
		if (!result.ok) {
			fail(result.message);
			return;
		}
		selected = selected.filter((entry) => entry !== item.id);
		await tick();
		const links = titleLinks().filter((link) => link.closest('tr')?.dataset.itemId !== item.id);
		const next = links[Math.min(index, links.length - 1)];
		(next ?? heading)?.focus();
	}

	async function act(action: () => Promise<{ ok: boolean; message?: string | null }>) {
		const result = await action();
		if (!result.ok) fail(result.message);
	}

	/** Entry whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (link, Escape, browser back) returns the focus to the row of its entry, or
	// to the heading if the row is gone.
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			const active = document.activeElement;
			if (active !== null && active !== document.body) return;
			const link = titleLinks().find((entry) => entry.closest('tr')?.dataset.itemId === previous);
			(link ?? heading)?.focus();
		});
	});

	function sourceDateOf(
		item: InboxItemSummary
	): { date: string; text: string; title: string } | null {
		if (item.sourceDate === null) return null;
		const date = berlinDateOf(item.sourceDate);
		return { date, text: formatCalendarDate(date), title: formatBerlinDateTime(item.sourceDate) };
	}
</script>

{#snippet duplicateHint(item: InboxItemSummary)}
	{@const duplicates = store.softDuplicates(item, openTickets)}
	{@const ticket = duplicates.tickets[0]}
	{@const other = duplicates.items[0]}
	{#if ticket !== undefined || other !== undefined}
		<p class="duplicate">
			<span class="duplicate-label">Mögliches Duplikat:</span>
			{#if ticket !== undefined}
				<a href={ticketPath(ticket.id)}>{ticket.key}</a>
				<button
					class="text-button"
					type="button"
					disabled={store.isPending(item.id)}
					onclick={() => act(() => store.assign(item.id, ticket.id, ticket.key))}
				>
					Dem Ticket {ticket.key} zuordnen
				</button>
			{:else if other !== undefined}
				<a href={inboxItemHref(other.id, page.url)}>anderer Eintrag „{other.title}“</a>
			{/if}
		</p>
	{/if}
{/snippet}

<section class="inbox-table" aria-labelledby={ids.heading} bind:this={root}>
	<SectionBar
		title="Eingang"
		headingId={ids.heading}
		count={ready ? `${rows.length}${store.handledHasMore ? '+' : ''}` : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="inbox" inboxCount={store.newCount} {projectsNewCount} />
		{/snippet}
		{#snippet end()}
			{@render actions?.()}
			<a class="capture" href={captureHref(page.url)}>Erfassen</a>
			{#if onclipboard}
				<button class="capture" type="button" aria-keyshortcuts="Control+V" onclick={onclipboard}>
					Aus Zwischenablage
				</button>
			{/if}
			{#if showsNew}
				<button
					class="bulk"
					type="button"
					aria-disabled={chosen.length === 0 ? 'true' : undefined}
					aria-describedby={chosen.length === 0 ? ids.bulkHint : undefined}
					onclick={() => {
						if (chosen.length > 0) onbulk();
					}}
				>
					Gesammelt umwandeln{chosen.length > 0 ? ` (${chosen.length})` : ''}
				</button>
				{#if chosen.length === 0}
					<span class="hint" id={ids.bulkHint}>Erst Einträge auswählen.</span>
				{/if}
			{/if}
		{/snippet}
	</SectionBar>

	<div class="chips">
		<ChipGroup
			legend="Quelle"
			name={`${uid}-source`}
			options={SOURCE_CHIPS}
			value={query.source}
			onchange={(value: SourceFamily | null) => navigate({ ...query, source: value })}
		/>
		<ChipGroup
			legend="Zustand"
			name={`${uid}-state`}
			options={STATE_CHIPS}
			value={query.state}
			all={null}
			onchange={(value: InboxState | null) => navigate({ ...query, state: value ?? 'new' })}
		/>
	</div>

	{@render tools?.()}

	<div role="status">
		{#if clipboardHint}
			<p class="clipboard-hint">{clipboardHint}</p>
		{/if}
	</div>

	{#snippet failure(message: string)}
		<SectionMessage tone="error" live>
			{message}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => store.reload()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{/snippet}

	{#if unavailable && store.error}
		{#if store.error === INBOX_UNAVAILABLE_MESSAGE}
			<SectionMessage tone="info" live>{store.error}</SectionMessage>
		{:else}
			{@render failure(store.error)}
		{/if}
	{:else if !showsNew && store.handledLoad === 'error' && store.handledError}
		{@render failure(store.handledError)}
	{:else if ready && rows.length === 0 && !store.handledHasMore}
		{#if query.source !== null}
			<EmptyState
				size="narrow"
				icon="search"
				title="Keine Einträge für diese Filter"
				description="Andere Quellen wählen oder den Filter zurücksetzen."
			>
				{#snippet primary()}
					<button class="button-primary" type="button" onclick={clearSource}>
						Filter zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else if showsNew}
			<EmptyState
				icon="inbox"
				title="Der Eingang ist leer"
				description="Hier landet, was du erfasst oder was deine Kanäle abrufen."
			>
				{#snippet primary()}
					<a class="button-primary" href={captureHref(page.url)}>Erfassen</a>
				{/snippet}
				{#snippet secondary()}
					<a class="button-subtle" href={resolve('/einstellungen/kanaele')}>Kanal einrichten</a>
				{/snippet}
			</EmptyState>
		{:else if query.state === 'discarded'}
			<EmptyState
				size="narrow"
				icon="inbox"
				title="Keine verworfenen Einträge"
				description="Verworfenes bleibt hier; der Inhalt wird nach 30 Tagen geleert."
			/>
		{:else}
			<EmptyState
				size="narrow"
				icon="inbox"
				title="Keine umgewandelten Einträge"
				description="Was du in ein Ticket umwandelst, steht danach hier mit einem Link zum Ticket."
			/>
		{/if}
	{:else if !ready}
		<p class="loading" role="status">Eingang wird geladen …</p>
	{/if}

	{#if rows.length > 0}
		<div class="frame">
			<table>
				<caption id={ids.caption}
					>{caption}<span class="caption-more">{MORE_COLUMNS_HINT}</span></caption
				>
				<thead>
					<tr>
						{#if showsNew}
							<th scope="col" class="select">
								<input
									type="checkbox"
									aria-label="Alle angezeigten Einträge auswählen"
									checked={allChosen}
									disabled={selectable.length === 0}
									onchange={(event) => toggleAll(event.currentTarget.checked)}
								/>
							</th>
						{/if}
						<th scope="col" data-col="kind">Art</th>
						<th scope="col" class="title-col">Titel</th>
						<th scope="col" data-col="source">Quelle</th>
						<th scope="col" data-col="source-date">Quelldatum</th>
						<th scope="col" data-col="arrival"
							>{showsNew ? 'Eingang' : STATE_LABELS[query.state]}</th
						>
						<th scope="col"><span class="visually-hidden">Aktionen</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as item (item.id)}
						{@const pending = store.isPending(item.id)}
						{@const sourceDate = sourceDateOf(item)}
						{@const arrival = showsNew ? item.created : (item.handledAt ?? item.created)}
						<tr class="row" class:active={item.id === activeId} data-item-id={item.id}>
							{#if showsNew}
								<td class="select">
									<input
										type="checkbox"
										aria-label={`Eintrag „${item.title}“ auswählen`}
										checked={selected.includes(item.id)}
										onchange={(event) => toggle(item.id, event.currentTarget.checked)}
									/>
								</td>
							{/if}
							<td class="kind" data-col="kind">{KIND_LABELS[item.kind]}</td>
							<th class="title" scope="row">
								<a
									class="title-link"
									href={inboxItemHref(item.id, page.url)}
									aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
								>
								{#if item.state === 'new'}
									{@render duplicateHint(item)}
								{/if}
							</th>
							<td class="source" data-col="source">{CHANNEL_LABELS[item.channel]}</td>
							<td class="date" data-col="source-date">
								{#if sourceDate !== null}
									<time datetime={sourceDate.date} title={sourceDate.title}>{sourceDate.text}</time>
								{:else}
									<span aria-hidden="true">–</span><span class="visually-hidden">kein Datum</span>
								{/if}
							</td>
							<td class="date" data-col="arrival">
								<time datetime={berlinDateOf(arrival)} title={formatBerlinDateTime(arrival)}>
									{formatCalendarDate(berlinDateOf(arrival))}
								</time>
							</td>
							<td class="actions">
								<span class="action-group">
									{#if item.state === 'new'}
										<a class="action primary" href={convertHref(item.id)}
											>Umwandeln<span class="visually-hidden">: „{item.title}“</span></a
										>
										<button
											class="action"
											type="button"
											disabled={pending}
											onclick={() => discard(item)}
										>
											Verwerfen<span class="visually-hidden">: „{item.title}“</span>
										</button>
									{:else if item.state === 'discarded'}
										<button
											class="action"
											type="button"
											disabled={pending}
											onclick={() => act(() => store.restore(item.id))}
										>
											Wiederherstellen<span class="visually-hidden">: „{item.title}“</span>
										</button>
									{:else if item.ticketId !== null}
										<a class="action" href={ticketPath(item.ticketId)}
											>Ticket ansehen<span class="visually-hidden">: „{item.title}“</span></a
										>
									{/if}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if !showsNew && store.handledLoad === 'ready' && (store.handledHasMore || store.loadingMoreHandled)}
		<!-- Below the table, so it stays reachable when every loaded row left the view. -->
		<button
			class="more"
			type="button"
			disabled={store.loadingMoreHandled}
			onclick={() => store.loadMoreHandled()}
		>
			{store.loadingMoreHandled ? 'Wird geladen …' : 'Weitere laden'}
		</button>
	{/if}
</section>

<style>
	.inbox-table {
		min-width: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin-bottom: 0.75rem;
	}

	.capture {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-brand-text);
		text-decoration: none;
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
	}

	.clipboard-hint {
		margin-bottom: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.bulk {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-brand-text);
		background: var(--color-surface);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.bulk[aria-disabled='true'] {
		color: var(--color-text-muted);
		border-color: var(--color-line);
		cursor: not-allowed;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Container of the column rules; the table takes its width and never more. */
	.frame {
		container-type: inline-size;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	table {
		width: 100%;
		font-size: 0.875rem;
		border-collapse: collapse;
	}

	.caption-more {
		display: none;
		font-weight: 400;
	}

	/* Columns that give way, in this order: arrival, Quelle, Art, Quelldatum. */
	@container (max-width: 52rem) {
		.caption-more {
			display: inline;
		}
	}

	@container (max-width: 52rem) {
		.frame :global([data-col='arrival']) {
			display: none;
		}
	}

	@container (max-width: 46rem) {
		.frame :global([data-col='source']) {
			display: none;
		}
	}

	@container (max-width: 40rem) {
		.frame :global([data-col='kind']) {
			display: none;
		}
	}

	@container (max-width: 34rem) {
		.frame :global([data-col='source-date']) {
			display: none;
		}
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	thead th {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.title-col {
		width: 100%;
	}

	.row {
		border-bottom: 1px solid var(--color-line);
	}

	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the open row: a bar at its start. */
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	td,
	.title {
		padding: 0.375rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	.title {
		font-weight: 400;
	}

	.title-link {
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	.duplicate {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.duplicate a {
		color: var(--color-brand-text);
	}

	.kind,
	.source,
	.date {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.date {
		font-variant-numeric: tabular-nums;
	}

	.select {
		width: 1.5rem;
	}

	.action-group {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		white-space: nowrap;
	}

	.action {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		text-decoration: none;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.action.primary {
		color: var(--color-brand-text);
		border-color: var(--color-brand);
	}

	.action:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.more {
		margin-top: 0.75rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.more:disabled {
		cursor: progress;
	}

	.loading {
		padding: 1.5rem 0;
		color: var(--color-text-muted);
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

	.text-button {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
</style>
