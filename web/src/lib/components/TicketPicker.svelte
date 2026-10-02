<script lang="ts">
	import { tick } from 'svelte';
	import { toDataError } from '$lib/data/errors';
	import { colorText, ticketColorOf } from '$lib/domain/colors';
	import { NO_PROJECT } from '$lib/domain/list-query';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
	import {
		PICKER_PAGE,
		PICKER_SERVER_WORDS,
		loosePattern,
		pickerList,
		pickerStatus,
		preferredIndex,
		searchWords,
		type PickerEntry,
		type PickerRule
	} from '$lib/domain/ticket-picker';
	import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
	import ColorMark from './ColorMark.svelte';
	import DueLabel from './DueLabel.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import StatusPill from './StatusPill.svelte';
	import SuggestionList from './SuggestionList.svelte';

	// Ticket picker (ADR-0042): one building block wherever a ticket is chosen. A combobox after the
	// WAI-ARIA pattern "combobox with listbox popup" whose list opens on focus or click without
	// typing: first the recently viewed or changed tickets, then the open ones grouped by project
	// ("Haus › Garten"), each with key, title, status, due date, the dot for "neu" and a short bar
	// of its color (ADR-0052, a bar so it never looks like the dot; named after the title). Typing
	// narrows over key and title without case and accents, several words must all match. The chips
	// "Nur offene" (on) and "Projekt" narrow further; without "Nur offene" the done tickets follow,
	// page by page from the server. At most PICKER_PAGE entries at first, the last option "Mehr
	// anzeigen" adds more. The rules of the place (`rules`) hide tickets or keep them visible but
	// not choosable, with the reason. The list lies in the top layer (SuggestionList, ADR-0025
	// section 5) below field and chips; the focus stays in the field (aria-activedescendant) or on
	// a chip, and leaving the picker closes the list. Keys: arrows, Home and End (in the list once
	// it was entered with an arrow or while the field is empty), Enter, Escape (list, then text,
	// then the owner). A polite live region names the number of hits after a short pause.
	let {
		label,
		source,
		value = $bindable(null),
		rules = [],
		error = null,
		hint = '',
		delay = 200,
		onchoose = () => undefined
	}: {
		label: string;
		/** Tickets, projects and the done tickets of the server. */
		source: TicketPickerSource;
		/** The chosen ticket, null while none is chosen. */
		value?: TicketSummary | null;
		/** Rules of the place: hide a ticket or keep it visible with a reason. */
		rules?: readonly PickerRule[];
		/** Field error (ADR-0009), e.g. "Bitte ein Ticket wählen." */
		error?: string | null;
		hint?: string;
		/** Pause after typing before the server is asked for done tickets, in milliseconds. */
		delay?: number;
		/** Called after a ticket was chosen. */
		onchoose?: (ticket: TicketSummary) => void;
	} = $props();

	/** Pause before the live region says the number of hits, in milliseconds. */
	const ANNOUNCE_DELAY = 500;
	/** Key of the option "Mehr anzeigen" among the moved-to options (ticket IDs have 15 characters). */
	const MORE = 'more';

	const uid = $props.id();
	const ids = {
		input: `${uid}-input`,
		listbox: `${uid}-listbox`,
		hint: `${uid}-hint`,
		error: `${uid}-error`,
		keys: `${uid}-keys`,
		project: `${uid}-project`,
		more: `${uid}-more`
	};
	const optionId = (ticket: TicketSummary) => `${uid}-option-${ticket.id}`;
	const groupId = (group: string) => `${uid}-group-${group.replace(/[^\w-]/g, '-')}`;

	let area = $state<HTMLElement>();
	let input = $state<HTMLInputElement>();
	let text = $state(value === null ? '' : choiceText(value));
	/** What the list is narrowed by; empty right after a choice, so the whole list shows again. */
	let query = $state('');
	let onlyOpen = $state(true);
	let project = $state('');
	let limit = $state(PICKER_PAGE);
	let expanded = $state(false);
	/**
	 * The option the keys moved to (ticket ID or MORE); null until then, so the typed key or the
	 * first choosable entry is active. Once set, Home and End belong to the list.
	 */
	let moved = $state<string | null>(null);
	let live = $state('');

	let done = $state<TicketSummary[]>([]);
	let donePage = $state(0);
	let doneHasMore = $state(false);
	let doneLoading = $state(false);
	let doneError = $state<string | null>(null);
	let doneController: AbortController | null = null;

	const words = $derived(searchWords(query));
	const projectIds = $derived.by((): ReadonlySet<string> | null => {
		if (project === '') return null;
		if (project === NO_PROJECT) return new Set([NO_PROJECT]);
		return new Set([project, ...source.subProjectsOf(project)]);
	});
	const list = $derived(
		pickerList({
			open: source.open,
			done: onlyOpen ? [] : done,
			recentIds: source.recentIds,
			words,
			onlyOpen,
			projectIds,
			projectOf: (ticket) => source.projectOf(ticket),
			projectOrder: source.projects,
			rules,
			limit
		})
	);
	const entries = $derived(list.groups.flatMap((group) => group.entries));
	/** More to show: entries beyond the limit, or further done tickets on the server. */
	const hasMore = $derived(list.shown < list.total || (!onlyOpen && doneHasMore));
	const optionCount = $derived(entries.length + (hasMore ? 1 : 0));
	const loadingOpen = $derived(source.openState === 'idle' || source.openState === 'loading');
	const showList = $derived(expanded && optionCount > 0);
	/** Index of the active option; entries.length is "Mehr anzeigen", -1 none. */
	const activeIndex = $derived.by(() => {
		if (!showList) return -1;
		if (moved === MORE && hasMore) return entries.length;
		const index = moved === null ? -1 : entries.findIndex((entry) => entry.ticket.id === moved);
		return index >= 0 ? index : preferredIndex(entries, query);
	});
	const activeId = $derived.by(() => {
		if (activeIndex < 0) return undefined;
		const entry = entries[activeIndex];
		return entry === undefined ? ids.more : optionId(entry.ticket);
	});
	const statusText = $derived.by(() => {
		if (source.openState === 'error') return 'Die offenen Tickets konnten nicht geladen werden.';
		if (loadingOpen) return 'Tickets werden geladen …';
		if (doneError !== null) return doneError;
		if (doneLoading && list.total === 0) return 'Erledigte werden geladen …';
		return pickerStatus(list, !onlyOpen && doneHasMore);
	});
	const describedBy = $derived(
		[hint === '' ? '' : ids.hint, ids.keys, error ? ids.error : ''].filter(Boolean).join(' ')
	);
	const chosenProjectLabel = $derived.by(() => {
		if (project === NO_PROJECT) return 'Ohne Projekt';
		const chosen = source.projects.find((candidate) => candidate.id === project);
		return chosen ? projectLabel(chosen) : undefined;
	});

	function choiceText(ticket: TicketSummary): string {
		return `${ticket.key} ${ticket.title}`;
	}

	function projectLabel(candidate: ProjectRef): string {
		return candidate.archived
			? `${projectPath(candidate)} (${candidate.code}, archiviert)`
			: projectChoiceLabel(candidate);
	}

	/** ID of the option at `index` for `moved`. */
	function optionKey(index: number): string | null {
		if (index < 0) return null;
		return entries[index]?.ticket.id ?? (index === entries.length && hasMore ? MORE : null);
	}

	function open() {
		if (source.openState === 'idle' || source.openState === 'error') source.load();
		if (!expanded) {
			expanded = true;
			moved = null;
		}
	}

	function close() {
		expanded = false;
		moved = null;
	}

	/** Says `message` in the live region, also when it is the same text as before. */
	async function announce(message: string) {
		live = '';
		await tick();
		live = message;
	}

	function choose(entry: PickerEntry) {
		if (entry.reason !== null) {
			void announce(`${entry.ticket.key} ist nicht wählbar: ${entry.reason}`);
			return;
		}
		value = entry.ticket;
		text = choiceText(entry.ticket);
		query = '';
		limit = PICKER_PAGE;
		close();
		void announce(`${entry.ticket.key} gewählt.`);
		onchoose(entry.ticket);
	}

	/** "Mehr anzeigen": further entries, if needed the next page of done tickets. */
	async function showMore() {
		if (doneLoading) return;
		const first = entries.length;
		if (list.shown < list.total) {
			limit += PICKER_PAGE;
		} else if (!onlyOpen && doneHasMore) {
			limit += PICKER_PAGE;
			await loadDone(donePage + 1);
		}
		await tick();
		// The first new entry becomes active, else "Mehr anzeigen" stays.
		moved = optionKey(first) ?? optionKey(first - 1);
		void announce(statusText);
	}

	function oninput() {
		value = null;
		query = text;
		limit = PICKER_PAGE;
		moved = null;
		expanded = true;
		if (source.openState === 'idle') source.load();
	}

	function move(step: number) {
		if (!expanded) {
			open();
			return;
		}
		if (optionCount === 0) return;
		const next =
			activeIndex < 0
				? step > 0
					? 0
					: optionCount - 1
				: (activeIndex + step + optionCount) % optionCount;
		moved = optionKey(next);
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				move(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				move(-1);
				break;
			case 'Home':
			case 'End':
				// In the text the keys move the caret, unless the list was entered with the arrows.
				if (!showList || (moved === null && text !== '')) return;
				event.preventDefault();
				moved = optionKey(event.key === 'Home' ? 0 : optionCount - 1);
				break;
			case 'Enter': {
				if (!showList || activeIndex < 0) return;
				event.preventDefault();
				const entry = entries[activeIndex];
				if (entry === undefined) void showMore();
				else choose(entry);
				break;
			}
			case 'Tab':
				close();
				break;
		}
	}

	// Escape anywhere in the picker: the list, then the text; only then the owner gets it.
	function onareakeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (expanded) {
			event.preventDefault();
			event.stopPropagation();
			close();
			if (event.target !== input) input?.focus();
		} else if (event.target === input && text !== '') {
			event.preventDefault();
			event.stopPropagation();
			text = '';
			query = '';
			value = null;
		}
	}

	// Leaving the picker (field, chips and list) closes the list.
	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget;
		if (next instanceof Node && area?.contains(next)) return;
		close();
	}

	/** A chip changed the list: it shows from the top; a click from outside brings the focus in. */
	function refilter() {
		limit = PICKER_PAGE;
		moved = null;
		if (!(document.activeElement instanceof Node && area?.contains(document.activeElement))) {
			input?.focus();
		}
		open();
	}

	function toggleOnlyOpen() {
		onlyOpen = !onlyOpen;
		refilter();
	}

	function chooseProject(event: Event & { currentTarget: HTMLSelectElement }) {
		project = event.currentTarget.value;
		refilter();
	}

	/** Loads a page of done tickets for the current words and project; page 1 starts over. */
	async function loadDone(page: number) {
		doneController?.abort();
		const controller = new AbortController();
		doneController = controller;
		doneLoading = true;
		doneError = null;
		const chosen = project;
		try {
			const result = await source.listDone(
				{
					patterns: words.slice(0, PICKER_SERVER_WORDS).map(loosePattern),
					project: chosen === '' ? null : chosen,
					withSubProjects:
						chosen !== '' && chosen !== NO_PROJECT && source.subProjectsOf(chosen).length > 0
				},
				page,
				{ signal: controller.signal }
			);
			if (controller.signal.aborted) return;
			done = page === 1 ? result.items : [...done, ...result.items];
			donePage = page;
			doneHasMore = result.hasMore;
		} catch (failure) {
			if (controller.signal.aborted) return;
			const kind = toDataError(failure).kind;
			if (kind === 'aborted' || kind === 'session') return;
			doneError = 'Die erledigten Tickets konnten nicht geladen werden.';
			doneHasMore = false;
		} finally {
			if (doneController === controller) {
				doneController = null;
				doneLoading = false;
			}
		}
	}

	// Done tickets follow the words and the project, after a pause while typing (a side effect:
	// requests to the server). "Nur offene" drops them.
	$effect(() => {
		const wanted = !onlyOpen;
		const key = `${words.join(' ')}\u0000${project}`;
		if (!wanted) {
			doneController?.abort();
			done = [];
			donePage = 0;
			doneHasMore = false;
			doneError = null;
			return;
		}
		void key;
		const timer = setTimeout(() => void loadDone(1), delay);
		return () => clearTimeout(timer);
	});

	// The live region names the hits once typing pauses.
	$effect(() => {
		const message = statusText;
		if (!expanded) return;
		const timer = setTimeout(() => void announce(message), ANNOUNCE_DELAY);
		return () => clearTimeout(timer);
	});

	// The active option stays in sight while the arrow keys move through a long list.
	$effect(() => {
		const id = activeId;
		if (id === undefined) return;
		const element = document.getElementById(id);
		if (element !== null && typeof element.scrollIntoView === 'function') {
			element.scrollIntoView({ block: 'nearest' });
		}
	});

	$effect(() => () => doneController?.abort());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker" bind:this={area} onkeydown={onareakeydown} {onfocusout}>
	<label for={ids.input}>{label}</label>
	<input
		id={ids.input}
		bind:this={input}
		bind:value={text}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		placeholder="Liste öffnen oder tippen"
		aria-autocomplete="list"
		aria-expanded={showList}
		aria-controls={ids.listbox}
		aria-activedescendant={activeId}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{oninput}
		{onkeydown}
		onfocus={open}
		onclick={open}
	/>
	<div class="tools">
		<button
			class="chip"
			type="button"
			aria-pressed={onlyOpen}
			onmousedown={(event) => event.preventDefault()}
			onclick={toggleOnlyOpen}
		>
			{#if onlyOpen}
				<svg class="check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M3.5 8.5l3 3 6-7" />
				</svg>
			{/if}
			Nur offene
		</button>
		<label class="chip project" for={ids.project}>
			<span>Projekt</span>
			<select id={ids.project} title={chosenProjectLabel} value={project} onchange={chooseProject}>
				<option value="">Alle</option>
				{#each source.projects as candidate (candidate.id)}
					<option value={candidate.id}>{projectLabel(candidate)}</option>
				{/each}
				<option value={NO_PROJECT}>Ohne Projekt</option>
			</select>
		</label>
		<span class="count" aria-hidden="true">{statusText}</span>
	</div>
	<SuggestionList
		id={ids.listbox}
		label="Tickets"
		open={showList}
		anchor={() => area?.querySelector('.tools')?.getBoundingClientRect() ?? null}
		maxHeight={320}
		revision={entries}
	>
		{#each list.groups as group (group.id)}
			<li role="none">
				<ul class="group" role="group" aria-labelledby={groupId(group.id)}>
					<li class="group-label" role="presentation" id={groupId(group.id)}>{group.label}</li>
					{#each group.entries as entry (entry.ticket.id)}
						{@const index = entries.indexOf(entry)}
						{@const ticket = entry.ticket}
						{@const color = ticketColorOf(ticket, source.projectOf(ticket))}
						<!-- Options are never focused: the keyboard works on the field
						     (aria-activedescendant), the click is for the mouse. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<li
							id={optionId(ticket)}
							class="option"
							class:active={index === activeIndex}
							class:blocked={entry.reason !== null}
							role="option"
							aria-selected={index === activeIndex}
							aria-disabled={entry.reason !== null ? 'true' : undefined}
							onclick={() => choose(entry)}
						>
							<span class="line">
								{#if source.isNew(ticket)}
									<span class="new" title="Neu"></span><span class="visually-hidden">Neu: </span>
								{/if}
								{#if color}<span class="color-bar"
										><ColorMark shown={color} kind="stripe" named={false} /></span
									>{/if}
								<span class="key">{ticket.key}</span>
								<span class="title">{ticket.title}</span>
								{#if color}<span class="visually-hidden">, {colorText(color)}</span>{/if}
								{#if value?.id === ticket.id}
									<svg class="check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M3.5 8.5l3 3 6-7" />
									</svg>
									<span class="visually-hidden">(gewählt)</span>
								{/if}
							</span>
							<span class="meta">
								<StatusPill status={ticket.status} />
								{#if ticket.due !== null}
									<DueLabel due={ticket.due} today={source.today} done={ticket.status === 'done'} />
								{/if}
								{#if entry.reason !== null}
									<span class="reason">Nicht wählbar: {entry.reason}</span>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
		{#if hasMore}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id={ids.more}
				class="option more"
				class:active={activeIndex === entries.length}
				role="option"
				aria-selected={activeIndex === entries.length}
				aria-disabled={doneLoading ? 'true' : undefined}
				aria-busy={doneLoading ? 'true' : undefined}
				onclick={() => void showMore()}
			>
				{doneLoading ? 'Wird geladen …' : 'Mehr anzeigen'}
			</li>
		{/if}
	</SuggestionList>
	{#if hint !== ''}
		<p class="hint" id={ids.hint}>{hint}</p>
	{/if}
	<p class="visually-hidden" id={ids.keys}>
		Die Liste öffnet sich beim Fokus. Tippen filtert nach Key und Titel. Pfeiltasten wählen aus,
		Enter übernimmt, Escape schließt die Liste.
	</p>
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<p class="visually-hidden" aria-live="polite">{live}</p>
</div>

<style>
	.picker {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	input {
		width: 100%;
		padding: 0.25rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
	}

	.chip {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		max-width: 100%;
		min-width: 0;
		padding: 0.125rem 0.5rem;
		font-size: var(--font-size-small);
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	.chip:hover {
		color: var(--color-text);
	}

	.chip[aria-pressed='true'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.project span {
		flex: none;
	}

	.project select {
		font-size: var(--font-size-small);
		color: var(--color-text);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.count {
		margin-left: auto;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.check {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.group {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.group-label {
		padding: 0.375rem 0.625rem 0.125rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.option {
		display: grid;
		gap: 0.125rem;
	}

	.line {
		display: flex;
		gap: 0.375rem;
		align-items: baseline;
		min-width: 0;
	}

	.key {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--font-size-small);
		color: var(--color-brand-text);
	}

	/* The color of the ticket (ADR-0052): a short bar as high as the key, in its middle. */
	.color-bar {
		display: flex;
		flex: none;
		align-self: center;
		height: 0.875rem;
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.new {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		background: var(--color-brand);
		border-radius: 50%;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
	}

	.reason {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.option.blocked {
		color: var(--color-text-muted);
		cursor: not-allowed;
	}

	.option.blocked .key,
	.option.blocked .title {
		color: var(--color-text-muted);
	}

	.more {
		font-weight: 600;
		color: var(--color-brand-text);
	}

	/* More tickets are being loaded (ADR-0026, addendum of 2026-09-30). */
	.option.more[aria-busy='true'] {
		cursor: progress;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
