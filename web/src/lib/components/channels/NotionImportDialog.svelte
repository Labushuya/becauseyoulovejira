<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from '$lib/domain/format';
	import {
		NOTION_DEFAULT_LIMITS,
		NOTION_SOURCE_TYPES,
		NOTION_SOURCE_TYPE_LABELS,
		blockedReason,
		entriesText,
		importBatchSize,
		limitsText,
		notionInboxQuery,
		preselectedRefs,
		progressText,
		runSummary,
		runningText,
		truncatedText,
		type NotionImportResult,
		type NotionPreview,
		type NotionPreviewItem,
		type NotionSource,
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
	import type { NotionImportRun } from '$lib/stores/notion-run';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Listen übernehmen" from Notion (ADR-0041 §9, plan notion-import NI-2) on the modal building
	// block (ADR-0025 section 3, size L), in two steps within the one dialog (no dialog from a
	// dialog): choose a shared source (search of Notion, "Liste aktualisieren"), then its preview
	// with the entries and their state in the inbox. The selection follows the tables (ADR-0036 §2:
	// head checkbox with "some" state, Shift for a range, only what can be chosen); entries that are
	// in the inbox already, and done ones while they are skipped, stay visible but cannot be chosen.
	// "N Einträge in den Eingang übernehmen" runs in blocks (fix 2026-09-30, ADR-0041 addendum): the
	// button says "N Einträge werden übernommen …", a progress bar with the count stands above the
	// options (scrolled into view), "Nach diesem Block anhalten" or Esc stop after the current block.
	// An entry leaves the selection only with its own result, and only when it is in the inbox now;
	// failed and unsent ones stay chosen. The result (counts, errors, "Im Eingang ansehen") takes the
	// place of the progress. Notion only answers questions; nothing is written there.
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
		dateProperty: `${uid}-date-property`,
		head: `${uid}-head`
	};

	type SourcesView =
		| { kind: 'loading' }
		| { kind: 'ready'; sources: NotionSource[]; truncated: boolean }
		| { kind: 'failed'; message: string; tone: 'error' | 'info' };
	type PreviewView =
		| { kind: 'loading' }
		| { kind: 'ready'; preview: NotionPreview }
		| { kind: 'failed'; message: string; tone: 'error' | 'info' };

	let phase = $state<'sources' | 'preview'>('sources');
	let query = $state('');
	let sourcesView = $state<SourcesView>({ kind: 'loading' });
	let chosenSource = $state<NotionSource | null>(null);
	let previewView = $state<PreviewView>({ kind: 'loading' });
	let skipDone = $state(true);
	let copyContent = $state(false);
	/** null: the first date property of the database (the server decides); '': none. */
	let dateProperty = $state<string | null>(null);
	let selection = $state<Selection>(EMPTY_SELECTION);
	/** Shift at the moment a row was pressed (the click on the label does not keep it reliably). */
	let shift = false;
	let running = $state(false);
	/** "Nach diesem Block anhalten" was asked for. */
	let stopping = $state(false);
	let handled = $state(0);
	let total = $state(0);
	let lastRun = $state<NotionImportRun | null>(null);
	const results = new SvelteMap<string, NotionImportResult>();
	let controller: AbortController | null = null;
	/** Stops the running import after its current block. */
	let stopper: AbortController | null = null;
	let heading = $state<HTMLElement>();
	let headBox = $state<HTMLInputElement>();
	let runBox = $state<HTMLElement>();
	let closeButton = $state<HTMLButtonElement>();

	const imported = $derived(notion.imports(connectionId) ?? []);
	const preview = $derived(previewView.kind === 'ready' ? previewView.preview : null);
	const items = $derived(preview?.items ?? []);
	const chosable = $derived(items.filter((item) => reasonOf(item) === '').map((item) => item.ref));
	const chosen = $derived(selection.ids.filter((ref) => chosable.includes(ref)));
	const head = $derived(headState(selection, chosable));
	const doneCount = $derived(items.filter((item) => item.done && item.state === '').length);
	const knownCount = $derived(items.filter((item) => item.state !== '').length);
	const isDatabase = $derived(chosenSource?.type === 'data_source');
	/** Before the first run always; afterwards while something is chosen (else "Schließen" leads). */
	const offerImport = $derived(lastRun === null || chosen.length > 0);
	const summary = $derived(
		lastRun === null
			? null
			: runSummary({
					counts: lastRun.counts,
					error: lastRun.error,
					stopped: lastRun.stopped,
					open: lastRun.open.length
				})
	);
	const failures = $derived(
		(lastRun?.results ?? [])
			.filter((result) => result.status === 'failed')
			.map((result) => ({
				ref: result.ref,
				title: items.find((item) => item.ref === result.ref)?.title ?? '',
				message: result.message
			}))
	);
	/** "12 Einträge, davon 2 schon im Eingang, 3 erledigt. 1 leerer Punkt ausgelassen." */
	const overview = $derived.by(() => {
		const parts = [entriesText(items.length)];
		if (knownCount > 0) parts.push(`davon ${knownCount} schon im Eingang`);
		if (doneCount > 0) parts.push(`${doneCount} erledigt`);
		const blank = preview?.blankPoints ?? 0;
		const blankText =
			blank === 0
				? ''
				: ` ${blank === 1 ? '1 leerer Punkt' : `${blank} leere Punkte`} ausgelassen.`;
		return `${parts.join(', ')}.${blankText}`;
	});

	// The head checkbox shows "some" as indeterminate (ADR-0036 §2).
	$effect(() => {
		if (headBox) headBox.indeterminate = head === 'some';
	});

	// A request still running when the dialog goes away is aborted; an import stops after its block.
	$effect(() => () => {
		controller?.abort();
		stopper?.abort();
	});

	// The list of sources loads when the dialog opens.
	$effect(() => untrack(() => void loadSources()));

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
		sourcesView = { kind: 'ready', ...outcome.value };
		if (chosenSource !== null && !outcome.value.sources.some((s) => s.id === chosenSource?.id)) {
			chosenSource = null;
		}
	}

	function toneOf(kind: 'missing' | 'disabled' | 'error'): 'error' | 'info' {
		return kind === 'error' ? 'error' : 'info';
	}

	async function loadPreview() {
		if (chosenSource === null) return;
		const current = begin();
		previewView = { kind: 'loading' };
		results.clear();
		lastRun = null;
		const outcome = await notion.preview(
			connectionId,
			{ type: chosenSource.type, id: chosenSource.id },
			chosenSource.type === 'data_source' ? dateProperty : null,
			current.signal
		);
		if (controller !== current) return;
		controller = null;
		if (outcome === null) return;
		if (outcome.kind !== 'ok') {
			previewView = { kind: 'failed', message: outcome.message, tone: toneOf(outcome.kind) };
			return;
		}
		previewView = { kind: 'ready', preview: outcome.value };
		dateProperty = outcome.value.dateProperty;
		selection = { ids: preselectedRefs(outcome.value.items, skipDone), anchor: null };
	}

	async function focusHeading() {
		await tick();
		heading?.focus();
	}

	async function showPreview(event: Event) {
		event.preventDefault();
		if (chosenSource === null) return;
		phase = 'preview';
		copyContent = false;
		dateProperty = null;
		void focusHeading();
		await loadPreview();
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

	/** Why an entry cannot be chosen now: in the inbox, done and skipped, or taken just now. */
	function reasonOf(item: NotionPreviewItem): string {
		const result = results.get(item.ref);
		if (result?.status === 'created') return 'Jetzt im Eingang.';
		if (result?.status === 'duplicate' || result?.status === 'skipped') {
			return result.message || 'Schon im Eingang.';
		}
		return blockedReason(item, skipDone);
	}

	function toggle(ref: string, on: boolean) {
		selection = clickRow(selection, ref, on, chosable, shift);
		shift = false;
	}

	function changeSkipDone(value: boolean) {
		skipDone = value;
		selection = keepShown(selection, chosable);
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

	function sourcesOf(list: readonly NotionSource[], type: NotionSourceType): NotionSource[] {
		return list.filter((source) => source.type === type);
	}

	/** The Notion entries of the inbox after `run` ("Im Eingang ansehen"). */
	function inboxHref(run: NotionImportRun): ResolvedPathname {
		return `${resolve('/eingang')}${notionInboxQuery(run.counts)}` as ResolvedPathname;
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
		if (running || preview === null || chosenSource === null || chosen.length === 0) return;
		const refs = [...chosen];
		const withContent = isDatabase && copyContent;
		const current = new AbortController();
		stopper = current;
		running = true;
		stopping = false;
		handled = 0;
		total = refs.length;
		lastRun = null;
		void revealRun();
		let run: NotionImportRun | null;
		try {
			run = await notion.runImport(
				connectionId,
				{
					source: { type: chosenSource.type, id: chosenSource.id },
					refs,
					skipDone,
					copyContent: withContent,
					dateProperty: isDatabase ? dateProperty : null
				},
				importBatchSize(preview.limits, withContent, items.length),
				{
					stop: current.signal,
					onblock: (block) => {
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
		<a class="button-subtle" href={inboxHref(lastRun)}>Im Eingang ansehen</a>
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
		<h3 id={ids.heading} tabindex="-1" bind:this={heading}>Quelle wählen</h3>
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
				{#each NOTION_SOURCE_TYPES as type (type)}
					{@const list = sourcesOf(sourcesView.sources, type)}
					{#if list.length > 0}
						<fieldset class="entries">
							<legend>{type === 'data_source' ? 'Datenbanken' : 'Seiten'}</legend>
							<ul>
								{#each list as source (source.id)}
									<li>
										<label>
											<input
												type="radio"
												name={`${uid}-source`}
												value={source.id}
												checked={chosenSource?.id === source.id}
												onchange={() => (chosenSource = source)}
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
	{:else if chosenSource !== null}
		<h3 id={ids.heading} tabindex="-1" bind:this={heading}>{chosenSource.title}</h3>
		<p class="links">
			<span class="hint">{NOTION_SOURCE_TYPE_LABELS[chosenSource.type]}</span>
			<ExternalLink href={chosenSource.url}>In Notion öffnen</ExternalLink>
		</p>

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
					actions={lastRun.counts.created + lastRun.counts.duplicates > 0 ? inboxLink : undefined}
				>
					{summary.text}
				</SectionMessage>
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
			<legend>Optionen</legend>
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
			{#if isDatabase}
				<div class="check">
					<input
						id={ids.copy}
						type="checkbox"
						bind:checked={copyContent}
						aria-describedby={ids.copyHint}
					/>
					<label for={ids.copy}>Seiteninhalt als Kopie mitnehmen</label>
					<p class="hint" id={ids.copyHint}>
						Der Inhalt der Seite jeder Zeile kommt als Text unter ihre Eigenschaften. {limitsText(
							preview?.limits ?? NOTION_DEFAULT_LIMITS
						)}
					</p>
				</div>
				{#if preview !== null && preview.dateProperties.length > 0}
					<div class="field">
						<label for={ids.dateProperty}>Datum aus</label>
						<select
							id={ids.dateProperty}
							value={dateProperty ?? ''}
							onchange={(event) => {
								dateProperty = event.currentTarget.value;
								void loadPreview();
							}}
						>
							{#each preview.dateProperties as name (name)}
								<option value={name}>{name}</option>
							{/each}
							<option value="">Kein Datum</option>
						</select>
					</div>
				{/if}
			{/if}
		</fieldset>

		{#if previewView.kind === 'loading'}
			<p class="hint" role="status">Die Einträge werden gelesen …</p>
		{:else if previewView.kind === 'failed'}
			<SectionMessage tone={previewView.tone} live>
				{previewView.message}
				{#snippet actions()}
					<button class="button-subtle" type="button" onclick={() => void loadPreview()}>
						Erneut versuchen
					</button>
				{/snippet}
			</SectionMessage>
		{:else if preview !== null}
			<p class="hint" aria-live="polite">{overview}</p>
			{#if preview.truncated}
				<SectionMessage tone="info" compact>
					{truncatedText(preview.limits, chosenSource.type)}
				</SectionMessage>
			{/if}
			{#if items.length === 0}
				<EmptyState
					size="compact"
					headingLevel={4}
					title="Keine Einträge"
					description={chosenSource.type === 'page'
						? 'Auf dieser Seite stehen keine To-do-, Aufzählungs- oder nummerierten Listen.'
						: 'Diese Datenbank hat keine Zeilen.'}
				/>
			{:else}
				<form id={ids.importForm} class="form" novalidate onsubmit={submit}>
					<div class="choice">
						<label class="head-box">
							<input
								type="checkbox"
								bind:this={headBox}
								checked={head === 'all'}
								disabled={chosable.length === 0 || running}
								onchange={() => (selection = toggleAll(selection, chosable))}
							/>
							<span>Alle wählbaren Einträge auswählen</span>
						</label>
						<span class="hint" aria-live="polite">{chosen.length} ausgewählt</span>
					</div>
					<fieldset class="entries">
						<legend class="visually-hidden">Einträge von {chosenSource.title}</legend>
						<ul>
							{#each items as item (item.ref)}
								{@const reason = reasonOf(item)}
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
											<span class="meta failed"><ErrorIcon /><span>{result.message}</span></span>
										{/if}
									</label>
								</li>
							{/each}
						</ul>
					</fieldset>
				</form>
			{/if}
		{/if}
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
				<button class="button-secondary back" type="button" onclick={back}>Andere Quelle</button>
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
				aria-disabled={chosenSource === null ? 'true' : undefined}
			>
				Weiter
			</button>
		{:else if items.length > 0 && (running || offerImport)}
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
	.links {
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

	select {
		padding: 0.375rem 0.5rem;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.head-box {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-control);
		cursor: pointer;
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

	/* "Andere Quelle" stands on the left, away from closing and taking over. */
	.back {
		margin-right: auto;
	}
</style>
