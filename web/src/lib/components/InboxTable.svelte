<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
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
	import { SOURCE_FAMILY_CHIPS, SOURCE_FAMILY_LABELS, type SourceFamily } from '$lib/domain/source';
	import type { TicketSummary } from '$lib/domain/ticket';
	import { INBOX_UNAVAILABLE_MESSAGE, type InboxStore } from '$lib/stores/inbox.svelte';
	import {
		captureHref,
		convertHref,
		inboxItemHref,
		ticketPath,
		withInboxQuery
	} from '$lib/ticket-links';
	import ChipGroup from './ChipGroup.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionBar from './SectionBar.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Inbox view (E4 plan, package 3; ADR-0014 sections 3 and 4; ADR-0019 section 6): section bar
	// "Eingang" with the switch and "Gesammelt umwandeln", the chips "Quelle" and "Zustand" (state
	// of the URL), and the table: selection, kind, title (link to the panel) with the hint on a
	// possible duplicate, source, date at the sender, arrival and the actions. New entries are
	// shown newest first, handled ones most recently handled first with "Weitere laden".
	// "Verwerfen" leaves the row in place for a few seconds with "Rückgängig" and moves the focus to
	// the next row. The date at the sender is only shown, never taken as due date (P-5).
	let {
		store,
		openTickets,
		activeId = null,
		selected = $bindable([]),
		projectsNewCount = 0,
		clipboardHint = null,
		onclipboard,
		onbulk,
		tools
	}: {
		store: InboxStore;
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
		rows.filter(
			(item) => item.state === 'new' && !store.isLingering(item.id) && selected.includes(item.id)
		)
	);
	const selectable = $derived(
		rows.filter((item) => item.state === 'new' && !store.isLingering(item.id))
	);
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
	/** Failure of an action (discard, restore, assign), shown until the next action. */
	let notice = $state<string | null>(null);

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
		notice = null;
		const result = await store.discard(item.id);
		if (!result.ok) {
			notice = result.message;
			return;
		}
		selected = selected.filter((entry) => entry !== item.id);
		await tick();
		const links = titleLinks().filter((link) => link.closest('tr')?.dataset.itemId !== item.id);
		const next = links[Math.min(index, links.length - 1)];
		(next ?? heading)?.focus();
	}

	async function act(action: () => Promise<{ ok: boolean; message?: string | null }>) {
		notice = null;
		const result = await action();
		if (!result.ok && result.message) notice = result.message;
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

	<p class="visually-hidden" aria-live="polite">{store.announcement}</p>
	<div role="status">
		{#if clipboardHint}
			<p class="clipboard-hint">{clipboardHint}</p>
		{/if}
	</div>
	<div aria-live="assertive">
		{#if notice}
			<div class="alert-error notice">
				<ErrorIcon />
				<span class="failure-text">{notice}</span>
				<button class="text-button" type="button" onclick={() => (notice = null)}>Schließen</button>
			</div>
		{/if}
	</div>

	{#if unavailable && store.error}
		{#if store.error === INBOX_UNAVAILABLE_MESSAGE}
			<p class="empty" role="status">{store.error}</p>
		{:else}
			<div class="alert-error notice">
				<ErrorIcon />
				<span class="failure-text">{store.error}</span>
				<button class="text-button" type="button" onclick={() => store.reload()}>
					Erneut versuchen
				</button>
			</div>
		{/if}
	{:else if !showsNew && store.handledLoad === 'error' && store.handledError}
		<div class="alert-error notice">
			<ErrorIcon />
			<span class="failure-text">{store.handledError}</span>
			<button class="text-button" type="button" onclick={() => store.reload()}>
				Erneut versuchen
			</button>
		</div>
	{:else if ready && rows.length === 0 && !store.handledHasMore}
		<div class="empty">
			{#if query.source !== null}
				<p>Keine Einträge für diese Filter.</p>
				<button class="text-button" type="button" onclick={clearSource}>Filter zurücksetzen</button>
			{:else if showsNew}
				<p>Der Eingang ist leer.</p>
				<p class="muted">
					Einträge kommen über <a href={captureHref(page.url)}>Erfassen</a> und die Kanäle, sobald sie
					eingerichtet sind.
				</p>
			{:else if query.state === 'discarded'}
				<p>Keine verworfenen Einträge.</p>
			{:else}
				<p>Keine umgewandelten Einträge.</p>
			{/if}
		</div>
	{:else if !ready}
		<p class="loading" role="status">Eingang wird geladen …</p>
	{/if}

	{#if rows.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="scroll" role="region" aria-labelledby={ids.caption} tabindex="0">
			<table>
				<caption id={ids.caption}>{caption}</caption>
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
						<th scope="col">Art</th>
						<th scope="col" class="title-col">Titel</th>
						<th scope="col">Quelle</th>
						<th scope="col">Quelldatum</th>
						<th scope="col">{showsNew ? 'Eingang' : STATE_LABELS[query.state]}</th>
						<th scope="col"><span class="visually-hidden">Aktionen</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as item (item.id)}
						{@const lingering = store.isLingering(item.id)}
						{@const pending = store.isPending(item.id)}
						{@const sourceDate = sourceDateOf(item)}
						{@const arrival = showsNew ? item.created : (item.handledAt ?? item.created)}
						<tr
							class="row"
							class:active={item.id === activeId}
							class:lingering
							data-item-id={item.id}
						>
							{#if showsNew}
								<td class="select">
									{#if !lingering}
										<input
											type="checkbox"
											aria-label={`Eintrag „${item.title}“ auswählen`}
											checked={selected.includes(item.id)}
											onchange={(event) => toggle(item.id, event.currentTarget.checked)}
										/>
									{/if}
								</td>
							{/if}
							<td class="kind">{KIND_LABELS[item.kind]}</td>
							<th class="title" scope="row">
								<a
									class="title-link"
									href={inboxItemHref(item.id, page.url)}
									aria-current={item.id === activeId ? 'page' : undefined}>{item.title}</a
								>
								{#if lingering}
									<span class="state-note">Verworfen</span>
								{:else if item.state === 'new'}
									{@render duplicateHint(item)}
								{/if}
							</th>
							<td class="source">{CHANNEL_LABELS[item.channel]}</td>
							<td class="date">
								{#if sourceDate !== null}
									<time datetime={sourceDate.date} title={sourceDate.title}>{sourceDate.text}</time>
								{:else}
									<span aria-hidden="true">–</span><span class="visually-hidden">kein Datum</span>
								{/if}
							</td>
							<td class="date">
								<time datetime={berlinDateOf(arrival)} title={formatBerlinDateTime(arrival)}>
									{formatCalendarDate(berlinDateOf(arrival))}
								</time>
							</td>
							<td class="actions">
								<span class="action-group">
									{#if lingering}
										<button
											class="undo"
											type="button"
											aria-label={`Rückgängig: „${item.title}“ wieder in den Eingang`}
											disabled={pending}
											onclick={() => act(() => store.undo(item.id))}
										>
											Rückgängig
										</button>
									{:else if item.state === 'new'}
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
		border-radius: 0.375rem;
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
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.bulk[aria-disabled='true'] {
		color: var(--color-text-muted);
		border-color: var(--color-line);
		cursor: not-allowed;
	}

	.hint,
	.muted {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.scroll {
		overflow-x: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	.scroll:focus-visible {
		outline-offset: 2px;
	}

	table {
		width: 100%;
		min-width: 48rem;
		font-size: 0.875rem;
		border-collapse: collapse;
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

	.lingering .title-link {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	.state-note {
		margin-left: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
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

	.select input {
		accent-color: var(--color-brand);
	}

	.action-group {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		white-space: nowrap;
	}

	.action,
	.undo {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		text-decoration: none;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.action.primary,
	.undo {
		color: var(--color-brand-text);
		border-color: var(--color-brand);
	}

	.action:disabled,
	.undo:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.more {
		margin-top: 0.75rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.more:disabled {
		cursor: progress;
	}

	.empty,
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

	.notice {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.failure-text {
		flex: 1;
	}

	.text-button {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
