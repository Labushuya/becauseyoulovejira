<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import {
		NO_COUNTS,
		NOTION_DEFAULT_LIMITS,
		NOTION_SOURCE_TYPES,
		NOTION_SOURCE_TYPE_LABELS,
		addCounts,
		blockedReason,
		entriesText,
		importBatchSize,
		limitsText,
		notionInboxQuery,
		preselectedRefs,
		progressText,
		runSummary,
		runningText,
		sourceResultText,
		subpagesHint,
		subpagesOverview,
		truncatedText,
		type NotionImportResult,
		type NotionPreview,
		type NotionPreviewItem,
		type NotionSource,
		type NotionSourceResult,
		type NotionSourceType
	} from '$lib/domain/notion';
	import {
		EMPTY_SELECTION,
		clickRow,
		headState,
		keepShown,
		toggleAll,
		type Selection
	} from '$lib/domain/selection';
	import type { NotionSourcesRun } from '$lib/stores/notion-run';
	import type { NotionImportPlan, NotionStore } from '$lib/stores/notion.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Listen übernehmen" from Notion (ADR-0041 §9, plan notion-import NI-2) on the modal building
	// block (ADR-0025 section 3, size L), in two steps within the one dialog (no dialog from a
	// dialog). Since the addendum of 2026-10-01 several sources at once:
	// 1. Choose shared sources with checkboxes (search of Notion, "Liste aktualisieren"); the choice
	//    follows the tables (ADR-0036 §2: head checkbox with "some" state, Shift for a range) and
	//    stays across searches.
	// 2. The preview groups the entries by source. Each group folds (disclosure), has "Alle aus …"
	//    and its own state; the previews load one after the other. An entry that a group above
	//    already lists (a sub-page chosen on its own as well) cannot be chosen twice. "Erledigte
	//    überspringen", "Seiteninhalt als Kopie mitnehmen" (databases) and "Unterseiten einbeziehen"
	//    (pages) count for every chosen source; "Datum aus" stands in the group of each database,
	//    whose properties differ.
	// "N Einträge in den Eingang übernehmen" runs over every source, one after the other, in blocks
	// (ADR-0041 addendum of 2026-09-30): one progress bar for all, "Nach diesem Block anhalten" or
	// Esc stop after the current block, an error of one source ends only that source. An entry leaves
	// the selection only with its own result, and only when it is in the inbox now. The result names
	// the counts of all, a line per source and the entries that failed. Notion only answers
	// questions; nothing is written there.
	let {
		connectionId,
		label,
		notion,
		onclose
	}: {
		connectionId: string;
		/** Name of the connection. */
		label: string;
		notion: NotionStore;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		summary: `${uid}-summary`,
		search: `${uid}-search`,
		sourceForm: `${uid}-sources`,
		importForm: `${uid}-import`,
		heading: `${uid}-heading`,
		skipDone: `${uid}-skip-done`,
		skipDoneHint: `${uid}-skip-done-hint`,
		copy: `${uid}-copy`,
		copyHint: `${uid}-copy-hint`,
		subpages: `${uid}-subpages`,
		subpagesHint: `${uid}-subpages-hint`
	};

	type SourcesView =
		| { kind: 'loading' }
		| { kind: 'ready'; sources: NotionSource[]; truncated: boolean }
		| { kind: 'failed'; message: string; tone: 'error' | 'info' };
	type PreviewView =
		| { kind: 'waiting' }
		| { kind: 'loading' }
		| { kind: 'ready'; preview: NotionPreview }
		| { kind: 'failed'; message: string; tone: 'error' | 'info' };
	/** A chosen source in the preview, with its own state, date property and fold. */
	interface Group {
		source: NotionSource;
		view: PreviewView;
		/** null: the first date property of the database (the server decides); '': none. */
		dateProperty: string | null;
		open: boolean;
	}

	let phase = $state<'sources' | 'preview'>('sources');
	let query = $state('');
	let sourcesView = $state<SourcesView>({ kind: 'loading' });
	/** Chosen sources, in the order of choosing; they stay chosen across searches. */
	let sourceSelection = $state<Selection>(EMPTY_SELECTION);
	/** Every source a list showed, so a chosen one stays known after another search. */
	const knownSources = new SvelteMap<string, NotionSource>();
	let groups = $state<Group[]>([]);
	let skipDone = $state(true);
	let copyContent = $state(false);
	let subpages = $state(false);
	let selection = $state<Selection>(EMPTY_SELECTION);
	/** Shift at the moment a row was pressed (the click on the label does not keep it reliably). */
	let shift = false;
	let running = $state(false);
	/** "Nach diesem Block anhalten" was asked for. */
	let stopping = $state(false);
	let handled = $state(0);
	let total = $state(0);
	let lastRun = $state<NotionSourcesRun | null>(null);
	/** The sources of the last run with their result (one line each). */
	let lastResults = $state<NotionSourceResult[]>([]);
	const results = new SvelteMap<string, NotionImportResult>();
	let controller: AbortController | null = null;
	/** Stops the running import after its current block. */
	let stopper: AbortController | null = null;
	let heading = $state<HTMLElement>();
	let runBox = $state<HTMLElement>();
	let closeButton = $state<HTMLButtonElement>();

	const imported = $derived(notion.imports(connectionId) ?? []);
	const shownSources = $derived.by(() => {
		const view = sourcesView;
		return view.kind === 'ready'
			? NOTION_SOURCE_TYPES.flatMap((type) => sourcesOf(view.sources, type))
			: [];
	});
	const shownSourceIds = $derived(shownSources.map((source) => source.id));
	const chosenSources = $derived(
		sourceSelection.ids.flatMap((id) => {
			const source = knownSources.get(id);
			return source === undefined ? [] : [source];
		})
	);
	const sourceHead = $derived(headState(sourceSelection, shownSourceIds));

	const readyGroups = $derived(
		groups.flatMap((group) =>
			group.view.kind === 'ready' ? [{ group, preview: group.view.preview }] : []
		)
	);
	/**
	 * The first group that lists an entry; a later group shows it as taken. Reversed, so the first
	 * group's pair is the last one the map keeps.
	 */
	const ownerOf = $derived(
		new Map(
			readyGroups
				.flatMap(({ group, preview }) =>
					preview.items.map((item) => [item.ref, group.source.id] as const)
				)
				.reverse()
		)
	);
	const chosable = $derived(
		readyGroups.flatMap(({ group, preview }) =>
			preview.items.filter((item) => reasonOf(item, group) === '').map((item) => item.ref)
		)
	);
	const chosen = $derived(selection.ids.filter((ref) => chosable.includes(ref)));
	const head = $derived(headState(selection, chosable));
	const hasDatabase = $derived(groups.some((group) => group.source.type === 'data_source'));
	const hasPage = $derived(groups.some((group) => group.source.type === 'page'));
	const allItems = $derived(readyGroups.flatMap(({ preview }) => preview.items));
	const limits = $derived(readyGroups[0]?.preview.limits ?? NOTION_DEFAULT_LIMITS);
	/** Before the first run always; afterwards while something is chosen (else "Schließen" leads). */
	const offerImport = $derived(lastRun === null || chosen.length > 0);
	const summary = $derived.by(() => {
		if (lastRun === null) return null;
		// With one source its error interrupts the run; with several, the others went on and each
		// source names its own error in its line. An error of the run is not counted twice.
		const single = lastResults.length === 1 ? (lastResults[0] ?? null) : null;
		let failedSources =
			single === null ? lastResults.filter((result) => result.error !== null).length : 0;
		if (lastRun.error !== null) failedSources = Math.max(0, failedSources - 1);
		return runSummary({
			counts: lastResults.reduce((sum, result) => addCounts(sum, result.counts), { ...NO_COUNTS }),
			error: lastRun.error ?? single?.error ?? null,
			stopped: lastRun.stopped,
			open: lastResults.reduce((sum, result) => sum + result.open, 0),
			failedSources
		});
	});
	const failures = $derived(
		[...results.values()]
			.filter((result) => result.status === 'failed')
			.map((result) => ({
				ref: result.ref,
				title: allItems.find((item) => item.ref === result.ref)?.title ?? '',
				message: result.message
			}))
	);
	/** "12 Einträge, davon 2 schon im Eingang, 3 erledigt. 1 leerer Punkt ausgelassen." */
	const overview = $derived.by(() => {
		const known = allItems.filter((item) => item.state !== '').length;
		const done = allItems.filter((item) => item.done && item.state === '').length;
		const blank = readyGroups.reduce((sum, { preview }) => sum + preview.blankPoints, 0);
		const from = groups.length > 1 ? ` aus ${groups.length} Quellen` : '';
		const parts = [`${entriesText(allItems.length)}${from}`];
		if (known > 0) parts.push(`davon ${known} schon im Eingang`);
		if (done > 0) parts.push(`${done} erledigt`);
		const blankText =
			blank === 0
				? ''
				: ` ${blank === 1 ? '1 leerer Punkt' : `${blank} leere Punkte`} ausgelassen.`;
		return `${parts.join(', ')}.${blankText}`;
	});
	const loadingPreviews = $derived(
		groups.some((group) => group.view.kind === 'loading' || group.view.kind === 'waiting')
	);

	// A request still running when the dialog goes away is aborted; an import stops after its block.
	$effect(() => () => {
		controller?.abort();
		stopper?.abort();
	});

	// The list of sources loads when the dialog opens.
	$effect(() => untrack(() => void loadSources()));

	/** Sets `indeterminate` of a checkbox ("some chosen", ADR-0036 §2). */
	function indeterminate(value: boolean) {
		return (node: HTMLInputElement) => {
			node.indeterminate = value;
		};
	}

	function begin(): AbortController {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		return current;
	}

	async function loadSources() {
		const current = begin();
		sourcesView = { kind: 'loading' };
		const outcome = await notion.sources(connectionId, query, current.signal);
		if (controller !== current) return;
		controller = null;
		if (outcome === null) return;
		if (outcome.kind !== 'ok') {
			sourcesView = { kind: 'failed', message: outcome.message, tone: toneOf(outcome.kind) };
			return;
		}
		for (const source of outcome.value.sources) knownSources.set(source.id, source);
		sourcesView = { kind: 'ready', ...outcome.value };
	}

	function toneOf(kind: 'missing' | 'disabled' | 'error'): 'error' | 'info' {
		return kind === 'error' ? 'error' : 'info';
	}

	function sourcesOf(list: readonly NotionSource[], type: NotionSourceType): NotionSource[] {
		return list.filter((source) => source.type === type);
	}

	function toggleSource(id: string, on: boolean) {
		sourceSelection = clickRow(sourceSelection, id, on, shownSourceIds, shift);
		shift = false;
	}

	/** Why an entry cannot be chosen now: listed above, in the inbox, done and skipped, taken now. */
	function reasonOf(item: NotionPreviewItem, group: Group): string {
		const owner = ownerOf.get(item.ref);
		if (owner !== undefined && owner !== group.source.id) {
			return `Steht schon unter „${knownSources.get(owner)?.title ?? ''}“.`;
		}
		const result = results.get(item.ref);
		if (result?.status === 'created') return 'Jetzt im Eingang.';
		if (result?.status === 'duplicate' || result?.status === 'skipped') {
			return result.message || 'Schon im Eingang.';
		}
		return blockedReason(item, skipDone);
	}

	function chosableOf(group: Group): string[] {
		if (group.view.kind !== 'ready') return [];
		return group.view.preview.items
			.filter((item) => reasonOf(item, group) === '')
			.map((item) => item.ref);
	}

	/**
	 * Loads the previews of `targets`, one after the other (each its own request to the server, as
	 * the rate of Notion asks for), and chooses what can be chosen in each.
	 */
	async function loadPreviews(targets: readonly Group[]) {
		const current = begin();
		// The entries a group listed before: a new preview replaces their choice (as in one source).
		const previous = new Map(
			targets.map((group) => [
				group.source.id,
				new Set(group.view.kind === 'ready' ? group.view.preview.items.map((item) => item.ref) : [])
			])
		);
		for (const group of targets) group.view = { kind: 'waiting' };
		for (const group of targets) {
			if (controller !== current) return;
			group.view = { kind: 'loading' };
			const isDatabase = group.source.type === 'data_source';
			const outcome = await notion.preview(
				connectionId,
				{
					source: { type: group.source.type, id: group.source.id },
					dateProperty: isDatabase ? group.dateProperty : null,
					subpages: !isDatabase && subpages
				},
				current.signal
			);
			if (controller !== current) return;
			if (outcome === null) {
				group.view = { kind: 'waiting' };
				continue;
			}
			if (outcome.kind !== 'ok') {
				group.view = { kind: 'failed', message: outcome.message, tone: toneOf(outcome.kind) };
				continue;
			}
			const before = previous.get(group.source.id) ?? new Set<string>();
			group.view = { kind: 'ready', preview: outcome.value };
			if (isDatabase) group.dateProperty = outcome.value.dateProperty;
			const ownedHere = (ref: string) => (ownerOf.get(ref) ?? group.source.id) === group.source.id;
			const wanted = preselectedRefs(outcome.value.items, skipDone).filter(ownedHere);
			// What this group listed before goes, unless a group above lists it now (its choice).
			const kept = selection.ids.filter((ref) => !before.has(ref) || !ownedHere(ref));
			selection = {
				ids: [...kept, ...wanted.filter((ref) => !kept.includes(ref))],
				anchor: null
			};
		}
		if (controller === current) controller = null;
	}

	async function focusHeading() {
		await tick();
		heading?.focus();
	}

	async function showPreview(event: Event) {
		event.preventDefault();
		if (chosenSources.length === 0) return;
		phase = 'preview';
		copyContent = false;
		results.clear();
		lastRun = null;
		lastResults = [];
		selection = EMPTY_SELECTION;
		groups = chosenSources.map((source) => ({
			source,
			view: { kind: 'waiting' },
			dateProperty: null,
			open: true
		}));
		void focusHeading();
		await loadPreviews(groups);
	}

	function back() {
		if (running) return;
		controller?.abort();
		phase = 'sources';
		void focusHeading();
	}

	function searchSources(event: Event) {
		event.preventDefault();
		void loadSources();
	}

	function toggle(ref: string, on: boolean) {
		selection = clickRow(selection, ref, on, chosable, shift);
		shift = false;
	}

	function changeSkipDone(value: boolean) {
		skipDone = value;
		selection = keepShown(selection, chosable);
	}

	function changeSubpages(value: boolean) {
		subpages = value;
		void loadPreviews(groups.filter((group) => group.source.type === 'page'));
	}

	function changeDateProperty(group: Group, value: string) {
		group.dateProperty = value;
		void loadPreviews([group]);
	}

	function dateText(item: NotionPreviewItem): string {
		if (item.sourceDate === null) return '';
		return item.allDay
			? formatCalendarDate(berlinDateOf(item.sourceDate))
			: formatBerlinDateTime(item.sourceDate);
	}

	function metaLine(item: NotionPreviewItem): string {
		return [
			dateText(item),
			item.section === '' ? '' : `Abschnitt „${item.section}“`,
			item.done ? 'erledigt' : ''
		]
			.filter((part) => part !== '')
			.join(' · ');
	}

	function editedText(source: NotionSource): string {
		const known = imported.find((entry) => entry.id === source.id);
		const parts = [NOTION_SOURCE_TYPE_LABELS[source.type]];
		if (source.edited !== null) {
			try {
				parts.push(`bearbeitet ${formatBerlinDateTime(source.edited)}`);
			} catch {
				// An unreadable time of Notion only drops the part.
			}
		}
		if (known !== undefined) {
			parts.push(`schon übernommen: ${entriesText(known.count)}`);
		}
		return parts.join(' · ');
	}

	/** Meta line of a group: kind, number of entries, sub-pages. */
	function groupMeta(group: Group): string {
		const parts = [NOTION_SOURCE_TYPE_LABELS[group.source.type]];
		if (group.view.kind === 'ready') {
			parts.push(entriesText(group.view.preview.items.length));
			const sub = subpagesOverview(group.view.preview);
			if (sub !== '') parts.push(sub.slice(0, -1));
		}
		return parts.join(' · ');
	}

	/** The Notion entries of the inbox after the run ("Im Eingang ansehen"). */
	function inboxHref(): ResolvedPathname {
		const counts = lastResults.reduce((sum, result) => addCounts(sum, result.counts), {
			...NO_COUNTS
		});
		return `${resolve('/eingang')}${notionInboxQuery(counts)}` as ResolvedPathname;
	}

	/** Brings progress or result into the visible part of the content (the list may be long). */
	async function revealRun() {
		await tick();
		runBox?.scrollIntoView?.({ block: 'nearest' });
	}

	function stop() {
		if (!running || stopping) return;
		stopping = true;
		stopper?.abort();
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (running || chosen.length === 0) return;
		const plan: { plan: NotionImportPlan; title: string }[] = [];
		const picked = new Set(chosen);
		for (const { group, preview } of readyGroups) {
			// In the order of the source, whatever the order of choosing.
			const own = preview.items
				.map((item) => item.ref)
				.filter((ref) => picked.has(ref) && ownerOf.get(ref) === group.source.id);
			if (own.length === 0) continue;
			const isDatabase = group.source.type === 'data_source';
			const withContent = isDatabase && copyContent;
			plan.push({
				title: group.source.title,
				plan: {
					request: {
						source: { type: group.source.type, id: group.source.id },
						refs: own,
						skipDone,
						copyContent: withContent,
						dateProperty: isDatabase ? group.dateProperty : null,
						subpages: !isDatabase && subpages
					},
					size: importBatchSize(preview.limits, withContent, preview.items.length)
				}
			});
		}
		const current = new AbortController();
		stopper = current;
		running = true;
		stopping = false;
		handled = 0;
		total = plan.reduce((sum, entry) => sum + entry.plan.request.refs.length, 0);
		lastRun = null;
		void revealRun();
		let run: NotionSourcesRun | null;
		try {
			run = await notion.runImports(
				connectionId,
				plan.map((entry) => entry.plan),
				{
					stop: current.signal,
					onblock: (_source, block) => {
						for (const result of block) results.set(result.ref, result);
						handled += block.length;
					}
				}
			);
		} finally {
			running = false;
			stopping = false;
			if (stopper === current) stopper = null;
		}
		if (run === null) return;
		lastResults = plan.map(({ plan: { request }, title }) => {
			const done = run.runs.find((entry) => entry.key === request.source.id)?.run;
			return {
				id: request.source.id,
				title,
				counts: done?.counts ?? { ...NO_COUNTS },
				error: done?.error ?? null,
				open: done === undefined ? request.refs.length : done.open.length
			};
		});
		selection = keepShown(selection, chosable);
		lastRun = run;
		await tick();
		// The import button goes when nothing is left to choose; the focus must not get lost with it.
		if (!offerImport) closeButton?.focus();
		await revealRun();
	}
</script>

{#snippet inboxLink()}
	{#if lastRun !== null}
		<a class="button-subtle" href={inboxHref()}>Im Eingang ansehen</a>
	{/if}
{/snippet}

<Modal
	open
	size="l"
	title={`Listen aus Notion übernehmen: ${label}`}
	describedBy={ids.summary}
	busy={running}
	onbusyescape={stop}
	onclose={() => onclose()}
>
	<p id={ids.summary} class="hint">
		Übernommen werden Kopien in den Eingang, mit Link zurück zu Notion. Notion bleibt unverändert;
		die App liest nur.
	</p>

	{#if phase === 'sources'}
		<h3 id={ids.heading} tabindex="-1" bind:this={heading}>Quellen wählen</h3>
		<form class="search" role="search" onsubmit={searchSources}>
			<div class="search-row">
				<div class="search-field">
					<label for={ids.search}>
						<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
							<circle cx="7" cy="7" r="4.25" />
							<path d="M10.25 10.25L13.5 13.5" />
						</svg>
						<span class="visually-hidden">Quellen nach Titel suchen</span>
					</label>
					<input
						id={ids.search}
						type="search"
						autocomplete="off"
						placeholder="Nach Titel suchen"
						bind:value={query}
					/>
				</div>
				<button class="button-secondary" type="submit">Suchen</button>
				<button class="button-subtle" type="button" onclick={() => void loadSources()}>
					Liste aktualisieren
				</button>
			</div>
		</form>

		{#if sourcesView.kind === 'loading'}
			<p class="hint" role="status">Notion wird gefragt …</p>
		{:else if sourcesView.kind === 'failed'}
			<SectionMessage tone={sourcesView.tone} live>
				{sourcesView.message}
				{#snippet actions()}
					<button class="button-subtle" type="button" onclick={() => void loadSources()}>
						Erneut versuchen
					</button>
				{/snippet}
			</SectionMessage>
		{:else if sourcesView.sources.length === 0}
			<EmptyState
				size="compact"
				headingLevel={4}
				title={query.trim() === '' ? 'Noch nichts freigegeben' : 'Nichts gefunden'}
				description={query.trim() === ''
					? 'Die Integration sieht noch keine Seite. In Notion bei einer Seite oder Datenbank „•••“ → „Verbindungen“ → „Verbindung hinzufügen“ wählen, dann „Liste aktualisieren“.'
					: 'Keine freigegebene Seite oder Datenbank trägt diesen Titel. Frisch freigegebene findet Notion manchmal erst nach einem Moment.'}
			/>
		{:else}
			<form id={ids.sourceForm} class="form" novalidate onsubmit={showPreview}>
				<div class="choice">
					<label class="head-box">
						<input
							type="checkbox"
							checked={sourceHead === 'all'}
							{@attach indeterminate(sourceHead === 'some')}
							onchange={() => (sourceSelection = toggleAll(sourceSelection, shownSourceIds))}
						/>
						<span>Alle angezeigten Quellen auswählen</span>
					</label>
					<span class="hint" aria-live="polite">
						{chosenSources.length === 1 ? '1 Quelle' : `${chosenSources.length} Quellen`} ausgewählt
					</span>
				</div>
				{#each NOTION_SOURCE_TYPES as type (type)}
					{@const list = sourcesOf(sourcesView.sources, type)}
					{#if list.length > 0}
						<fieldset class="entries">
							<legend>{type === 'data_source' ? 'Datenbanken' : 'Seiten'}</legend>
							<ul>
								{#each list as source (source.id)}
									<li>
										<label onpointerdown={(event) => (shift = event.shiftKey)}>
											<input
												type="checkbox"
												checked={sourceSelection.ids.includes(source.id)}
												onkeydown={(event) => (shift = event.shiftKey)}
												onchange={(event) => toggleSource(source.id, event.currentTarget.checked)}
											/>
											<span class="title">{source.title}</span>
											<span class="meta">{editedText(source)}</span>
										</label>
									</li>
								{/each}
							</ul>
						</fieldset>
					{/if}
				{/each}
				{#if sourcesView.truncated}
					<SectionMessage tone="info" compact>
						Es gibt mehr freigegebene Seiten, als die Liste zeigt. Die Suche nach Titel grenzt sie
						ein.
					</SectionMessage>
				{/if}
			</form>
		{/if}
	{:else}
		<h3 id={ids.heading} tabindex="-1" bind:this={heading}>
			Vorschau: {groups.length === 1 ? (groups[0]?.source.title ?? '') : `${groups.length} Quellen`}
		</h3>

		<!-- Progress and result above the options, so a long list never hides them. -->
		{#if running}
			<div class="progress" role="status" bind:this={runBox}>
				<progress value={handled} max={total} aria-hidden="true"></progress>
				<span>{progressText(handled, total)}{stopping ? ' Hält nach diesem Block an.' : ''}</span>
			</div>
		{:else if lastRun !== null && summary !== null}
			<div class="run" bind:this={runBox}>
				<SectionMessage
					tone={summary.tone}
					title={summary.title}
					live
					headingLevel={4}
					actions={lastResults.some(
						(result) => result.counts.created + result.counts.duplicates > 0
					)
						? inboxLink
						: undefined}
				>
					{summary.text}
				</SectionMessage>
				{#if lastResults.length > 1}
					<ul class="per-source" aria-label="Ergebnis je Quelle">
						{#each lastResults as result (result.id)}
							<li class:failed={result.error !== null}>
								{#if result.error !== null}<ErrorIcon />{/if}
								<span><strong>{result.title}:</strong> {sourceResultText(result)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if failures.length > 0}
					<div class="alert-error failures">
						<h4>Nicht übernommen</h4>
						<ul>
							{#each failures as failure (failure.ref)}
								<li>
									<ErrorIcon />
									<span>„{failure.title}“: {failure.message}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}

		<fieldset class="options" disabled={running}>
			<legend>Optionen{groups.length > 1 ? ' (für alle gewählten Quellen)' : ''}</legend>
			<div class="check">
				<input
					id={ids.skipDone}
					type="checkbox"
					checked={skipDone}
					aria-describedby={ids.skipDoneHint}
					onchange={(event) => changeSkipDone(event.currentTarget.checked)}
				/>
				<label for={ids.skipDone}>Erledigte überspringen</label>
				<p class="hint" id={ids.skipDoneHint}>
					Abgehakte To-dos und Zeilen, deren Status in der Gruppe „Complete“ steht oder deren
					Kontrollkästchen „Erledigt“ gesetzt ist.
				</p>
			</div>
			{#if hasDatabase}
				<div class="check">
					<input
						id={ids.copy}
						type="checkbox"
						bind:checked={copyContent}
						aria-describedby={ids.copyHint}
					/>
					<label for={ids.copy}>Seiteninhalt als Kopie mitnehmen</label>
					<p class="hint" id={ids.copyHint}>
						Der Inhalt der Seite jeder Zeile einer Datenbank kommt als Text unter ihre
						Eigenschaften.
						{limitsText(limits)}
					</p>
				</div>
			{/if}
			{#if hasPage}
				<div class="check">
					<input
						id={ids.subpages}
						type="checkbox"
						checked={subpages}
						aria-describedby={ids.subpagesHint}
						onchange={(event) => changeSubpages(event.currentTarget.checked)}
					/>
					<label for={ids.subpages}>Unterseiten einbeziehen</label>
					<p class="hint" id={ids.subpagesHint}>{subpagesHint(limits)}</p>
				</div>
			{/if}
		</fieldset>

		{#if readyGroups.length > 0}
			<p class="hint" aria-live="polite">{overview}</p>
		{:else if loadingPreviews}
			<p class="hint" role="status">Die Einträge werden gelesen …</p>
		{/if}

		<form id={ids.importForm} class="form" novalidate onsubmit={submit}>
			{#if allItems.length > 0}
				<div class="choice">
					<label class="head-box">
						<input
							type="checkbox"
							checked={head === 'all'}
							{@attach indeterminate(head === 'some')}
							disabled={chosable.length === 0 || running}
							onchange={() => (selection = toggleAll(selection, chosable))}
						/>
						<span>Alle wählbaren Einträge auswählen</span>
					</label>
					<span class="hint" aria-live="polite">{chosen.length} ausgewählt</span>
				</div>
			{/if}
			{#each groups as group (group.source.id)}
				{@const groupId = `${uid}-group-${group.source.id}`}
				{@const own = chosableOf(group)}
				{@const groupHead = headState(selection, own)}
				<section class="group" aria-labelledby={`${groupId}-title`}>
					<div class="group-head">
						<h4>
							<button
								class="button-subtle toggle"
								type="button"
								aria-expanded={group.open}
								aria-controls={`${groupId}-body`}
								onclick={() => (group.open = !group.open)}
							>
								<svg
									class="chevron"
									viewBox="0 0 16 16"
									width="12"
									height="12"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M4 6l4 4 4-4" />
								</svg>
								<span id={`${groupId}-title`}>{group.source.title}</span>
							</button>
						</h4>
						<span class="meta">{groupMeta(group)}</span>
						<ExternalLink href={group.source.url}>In Notion öffnen</ExternalLink>
						{#if own.length > 0}
							<label class="group-box">
								<input
									type="checkbox"
									checked={groupHead === 'all'}
									{@attach indeterminate(groupHead === 'some')}
									disabled={running}
									onchange={() => (selection = toggleAll(selection, own))}
								/>
								<span>Alle aus „{group.source.title}“ auswählen</span>
							</label>
						{/if}
					</div>
					<div class="group-body" id={`${groupId}-body`} hidden={!group.open}>
						{#if group.view.kind === 'waiting'}
							<p class="hint">Wartet …</p>
						{:else if group.view.kind === 'loading'}
							<p class="hint" role="status">Die Einträge werden gelesen …</p>
						{:else if group.view.kind === 'failed'}
							<SectionMessage tone={group.view.tone} live>
								{group.view.message}
								{#snippet actions()}
									<button
										class="button-subtle"
										type="button"
										onclick={() => void loadPreviews([group])}
									>
										Erneut versuchen
									</button>
								{/snippet}
							</SectionMessage>
						{:else}
							{@const preview = group.view.preview}
							{#if group.source.type === 'data_source' && preview.dateProperties.length > 0}
								<div class="field">
									<label for={`${groupId}-date`}>Datum aus</label>
									<select
										id={`${groupId}-date`}
										value={group.dateProperty ?? ''}
										disabled={running}
										onchange={(event) => changeDateProperty(group, event.currentTarget.value)}
									>
										{#each preview.dateProperties as name (name)}
											<option value={name}>{name}</option>
										{/each}
										<option value="">Kein Datum</option>
									</select>
								</div>
							{/if}
							{#if preview.truncated}
								<SectionMessage tone="info" compact>
									{truncatedText(preview.limits, group.source.type)}
								</SectionMessage>
							{/if}
							{#if preview.items.length === 0}
								<p class="hint">
									{group.source.type === 'page'
										? 'Keine Einträge: Auf dieser Seite stehen keine To-do-, Aufzählungs- oder nummerierten Listen.'
										: 'Keine Einträge: Diese Datenbank hat keine Zeilen.'}
								</p>
							{:else}
								<fieldset class="entries">
									<legend class="visually-hidden">Einträge von {group.source.title}</legend>
									<ul>
										{#each preview.items as item (item.ref)}
											{@const reason = reasonOf(item, group)}
											{@const result = results.get(item.ref)}
											<li class:blocked={reason !== ''}>
												<label onpointerdown={(event) => (shift = event.shiftKey)}>
													<input
														type="checkbox"
														checked={reason === '' && selection.ids.includes(item.ref)}
														disabled={reason !== '' || running}
														onkeydown={(event) => (shift = event.shiftKey)}
														onchange={(event) => toggle(item.ref, event.currentTarget.checked)}
													/>
													<span class="title">{item.title}</span>
													{#if metaLine(item) !== ''}
														<span class="meta">{metaLine(item)}</span>
													{/if}
													{#if item.excerpt !== ''}
														<span class="meta excerpt">{item.excerpt}</span>
													{/if}
													{#if reason !== ''}
														<span class="meta">{reason}</span>
													{:else if result?.status === 'failed'}
														<span class="meta failed"
															><ErrorIcon /><span>{result.message}</span></span
														>
													{/if}
												</label>
											</li>
										{/each}
									</ul>
								</fieldset>
							{/if}
						{/if}
					</div>
				</section>
			{/each}
		</form>
	{/if}

	{#snippet footer({ close })}
		{#if running}
			<button
				class="button-secondary"
				type="button"
				aria-disabled={stopping ? 'true' : undefined}
				onclick={stop}
			>
				{stopping ? 'Hält nach diesem Block an …' : 'Nach diesem Block anhalten'}
			</button>
		{:else}
			{#if phase === 'preview'}
				<button class="button-secondary back" type="button" onclick={back}>Andere Quellen</button>
			{/if}
			<button
				class={phase === 'preview' && !offerImport ? 'button-primary' : 'button-secondary'}
				type="button"
				bind:this={closeButton}
				onclick={close}
			>
				{lastRun === null ? 'Abbrechen' : 'Schließen'}
			</button>
		{/if}
		{#if phase === 'sources'}
			<button
				class="button-primary"
				type="submit"
				form={ids.sourceForm}
				aria-disabled={chosenSources.length === 0 ? 'true' : undefined}
			>
				Weiter
			</button>
		{:else if allItems.length > 0 && (running || offerImport)}
			<button
				class="button-primary"
				type="submit"
				form={ids.importForm}
				aria-disabled={running || chosen.length === 0 ? 'true' : undefined}
				aria-busy={running ? 'true' : undefined}
			>
				{running ? runningText(total) : `${entriesText(chosen.length)} in den Eingang übernehmen`}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3:focus {
		outline: none;
	}

	h3:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	.search {
		display: grid;
		gap: 0.25rem;
	}

	.search-row,
	.choice,
	.group-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.search-field {
		flex: 1;
		min-width: min(14rem, 100%);
	}

	label[for],
	legend {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.form,
	.options {
		display: grid;
		gap: 0.625rem;
	}

	.options {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.check {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.125rem 0.5rem;
		align-items: center;
	}

	.check .hint {
		grid-column: 2;
	}

	.check label {
		color: var(--color-text);
	}

	.field {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.head-box,
	.group-box {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-control);
		cursor: pointer;
	}

	.group-box {
		margin-left: auto;
	}

	/* A group per source (addendum of 2026-10-01): a heading with the fold, then its entries. */
	.group {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
	}

	.group h4 {
		min-width: 0;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.toggle {
		gap: 0.375rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.chevron {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		rotate: -90deg;
		transition: rotate var(--motion-fast) var(--motion-ease);
	}

	.toggle[aria-expanded='true'] .chevron {
		rotate: 0deg;
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	.group-body {
		display: grid;
		gap: 0.5rem;
	}

	.group-body[hidden] {
		display: none;
	}

	/* The content of the modal scrolls; the list has no scroll area of its own. */
	.entries {
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.entries legend:not(.visually-hidden) {
		padding: 0 0.375rem;
		margin-left: 0.5rem;
	}

	.entries ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entries li + li {
		border-top: 1px solid var(--color-line);
	}

	.entries label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.125rem 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
	}

	.entries input {
		grid-row: span 4;
		margin-top: 0.125rem;
	}

	.blocked label {
		cursor: default;
	}

	.blocked .title {
		color: var(--color-text-muted);
	}

	.title {
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.meta {
		grid-column: 2;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.group-head .meta {
		grid-column: auto;
	}

	.meta.failed {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		color: var(--color-danger);
	}

	.progress {
		display: grid;
		gap: 0.25rem;
		font-size: var(--font-size-control);
	}

	.run {
		display: grid;
		gap: 0.5rem;
	}

	.per-source {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		font-size: var(--font-size-control);
		list-style: none;
	}

	.per-source li {
		display: flex;
		gap: 0.375rem;
		align-items: flex-start;
		overflow-wrap: anywhere;
	}

	.per-source li.failed {
		color: var(--color-danger);
	}

	.failures {
		display: block;
	}

	.failures h4 {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.failures ul {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		font-size: var(--font-size-control);
		list-style: none;
	}

	.failures li {
		display: flex;
		gap: 0.375rem;
		align-items: flex-start;
		overflow-wrap: anywhere;
	}

	progress {
		inline-size: 100%;
		block-size: 0.375rem;
		accent-color: var(--color-brand);
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	/* "Andere Quellen" stands on the left, away from closing and taking over. */
	.back {
		margin-right: auto;
	}
</style>
