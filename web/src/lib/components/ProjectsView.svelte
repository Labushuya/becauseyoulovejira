<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Project } from '$lib/domain/project';
	import {
		PROJECT_SEARCH_MAX_LENGTH,
		effectiveProjectLayout,
		filterProjects,
		nextProjectSort,
		parseProjectViewQuery,
		projectRows,
		readCollapsedProjects,
		readStoredProjectLayout,
		writeCollapsedProjects,
		writeStoredProjectLayout,
		type ProjectLayout,
		type ProjectSortKey,
		type ProjectViewQuery
	} from '$lib/domain/project-view';
	import {
		archiveWithSubProjectsText,
		canDeleteProject,
		deleteProjectText
	} from '$lib/domain/project-tree';
	import { PROJECT_TICKETS_FAILED, openTicketsByProject } from '$lib/domain/project-tickets';
	import type { ProjectActions } from '$lib/project-route';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import type { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
	import { ProjectTicketsDisclosure } from '$lib/stores/project-tickets.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import {
		NEW_PROJECT_LINK_ID,
		newProjectHref,
		newSubProjectHref,
		projectHref,
		projectTicketsHref,
		projectsViewHref,
		withProjectViewQuery,
		withShowArchived
	} from '$lib/ticket-links';
	import type { MenuAction } from './ActionsMenu.svelte';
	import ColumnsPopover from './ColumnsPopover.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import ProjectTable from './ProjectTable.svelte';
	import ProjectTicketList from './ProjectTicketList.svelte';
	import ProjectTiles from './ProjectTiles.svelte';
	import SectionBar from './SectionBar.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Project view (E3 plan, T-3, T-11, T-12 and package 14; ADR-0010 section 1; ADR-0025 section
	// 10, package UI-8; user request after EH-4): the section bar with the switch "Aufgaben |
	// Projekte | Eingang" at the same place as in the other views, the search by name or code,
	// "Archivierte anzeigen", the pair of layout buttons "Liste | Kacheln" and "Neues Projekt"; below
	// it the projects as a list (default, ProjectTable with sortable columns) or as tiles, in the
	// same frame and width. Search, sort, the switch and the layout live in the URL; the layout is
	// also remembered in localStorage for the next visit. A row or tile opens the project panel
	// (/projekte/<id>) next to the view, "Neues Projekt" the panel /projekte/neu. Closing a panel
	// returns the focus to the link of its project, or to the heading if it is gone; closing "Neues
	// Projekt" without a project returns it to "Neues Projekt". The tags live in the settings
	// (/einstellungen/tags). "aktiv" comes from the list store, "gesamt" adds the done tickets the
	// server counts. Sub projects (ADR-0034, UP-3) stand as a tree below their parent in list and
	// tiles; folding is kept per tab in sessionStorage, and a search shows a matching sub project
	// with its parent as context. Every row of the list ends with the menu "•••" (plan
	// aktionsmenues, AM-4): "Öffnen" (the panel, where the project is edited), "Tickets anzeigen",
	// "Unterprojekt anlegen" (an active top-level project), and with `actions` "Archivieren", "Aus
	// dem Archiv holen" or "Mit Oberprojekt zurückholen" and "Löschen …" (only without tickets and
	// sub projects). Archiving with active sub projects and deleting ask first, as in the panel; the
	// list is no modal, so they are dialogs. Every tile has the same menu (AM-5), from `menuOf`.
	// Open tickets (ADR-0034, addendum "Offene Tickets in Projekten"): every row of the list opens
	// to the open tickets of its project (ProjectTicketList, from the list store, no request of its
	// own, live with realtime); "Alle aufklappen" and "Alle zuklappen" above the list. Which rows are
	// open is kept on this device (ProjectTicketsDisclosure). The tiles show no list (no room; their
	// "aktiv" already counts the open tickets, the panel lists them).
	let {
		catalog,
		tickets,
		stats,
		activeOf,
		totalOf,
		newOf = (project: Project) => tickets.newInProject(project.id),
		aggregatedOf = () => false,
		actions,
		activeId = null,
		creating = false,
		inboxCount = null,
		rowActions = null,
		duplicates = false
	}: {
		catalog: CatalogStore;
		tickets: TicketListStore;
		stats: ProjectStatsStore;
		/** Tickets of a project that are not done; null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** New tickets of a project for the signed-in user. */
		newOf?: (project: Project) => number;
		/** The numbers of the project include its sub projects (ADR-0034); said to screen readers. */
		aggregatedOf?: (project: Project) => boolean;
		/** Archiving, restoring and deleting from the menu of a row; without them it only links. */
		actions?: ProjectActions;
		/** Project shown in the panel; its row or tile is marked as current. */
		activeId?: string | null;
		/** The panel "Neues Projekt" is open. */
		creating?: boolean;
		/** New inbox entries for the switch (E4 plan, package 3). */
		inboxCount?: number | null;
		/** The menu "•••" of the open tickets (plan aktionsmenues, AM-2); without it they have none. */
		rowActions?: TicketRowActionsStore | null;
		/** "Duplizieren …" in that menu (ADR-0045). */
		duplicates?: boolean;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		search: `${uid}-search`,
		ticketTools: `${uid}-ticket-tools`
	};

	function storage(): Storage | null {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	}

	/** Layout remembered on this device; it applies when the URL names none. */
	let stored = $state<ProjectLayout | null>(readStoredProjectLayout(storage()));

	const query = $derived(parseProjectViewQuery(page.url.searchParams));
	const layout = $derived(effectiveProjectLayout(query, stored));
	/** Projects of the switch "Archivierte anzeigen", before the search. */
	const available = $derived(query.showArchived ? catalog.projects : catalog.activeProjects);
	function sessionStore(): Storage | null {
		try {
			return window.sessionStorage;
		} catch {
			return null;
		}
	}

	/** Parents whose sub projects are folded away (ADR-0034); per tab, default open. */
	const collapsed = new SvelteSet<string>(readCollapsedProjects(sessionStore()));
	const numbers = {
		active: (project: Project) => activeOf(project),
		total: (project: Project) => totalOf(project),
		fresh: (project: Project) => newOf(project)
	};
	/** The projects as a tree (ADR-0034): searched, sorted, folded; list and tiles show the same. */
	const rows = $derived(projectRows(available, query.search, query.sort, numbers, collapsed));

	/** Rows of the list that show their open tickets; kept on this device. */
	const disclosure = new ProjectTicketsDisclosure(window);
	$effect(() => disclosure.connect());
	/** The open tickets per project, ordered; only computed while a row shows its tickets. */
	const openByProject = $derived(openTicketsByProject(tickets.open));
	/** Every project of the list, folded sub projects too: "Alle aufklappen" opens them all. */
	const listedIds = $derived(
		projectRows(available, query.search, query.sort, numbers, new Set()).map(
			(row) => row.project.id
		)
	);
	const allOpen = $derived(listedIds.every((id) => disclosure.isOpen(id)));
	const noneOpen = $derived(!listedIds.some((id) => disclosure.isOpen(id)));

	/** "Alle aufklappen" and "Alle zuklappen"; the focus stays on the button. */
	function openAllTickets() {
		if (!allOpen) disclosure.openAll(listedIds);
	}

	function closeAllTickets() {
		if (!noneOpen) disclosure.closeAll();
	}

	/** The disclosure of the open tickets of a row, where the focus goes when its list empties. */
	function ticketsToggleOf(projectId: string): HTMLElement | null {
		return (
			[...(root?.querySelectorAll<HTMLElement>('[data-tickets-toggle]') ?? [])].find(
				(button) => button.dataset.ticketsToggle === projectId
			) ?? null
		);
	}
	/** Projects that match the search; parents shown only as context do not count. */
	const matchCount = $derived(filterProjects(available, query.search).length);
	const countLabel = $derived(matchCount === 1 ? '1 Projekt' : `${matchCount} Projekte`);

	/** Folds or unfolds the sub projects of a parent; the button keeps the focus. */
	function toggleFolded(project: Project) {
		if (collapsed.has(project.id)) collapsed.delete(project.id);
		else collapsed.add(project.id);
		writeCollapsedProjects(sessionStore(), [...collapsed]);
	}

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	// Columns of the list (ADR-0030), shared by the table and the menu "Spalten".
	const columnFit = new ColumnFit(getColumnPrefs('projects'));

	// Counts the done tickets of the available projects and of the one in the panel (again when the
	// set changes); a search does not change the set, so clearing it shows the numbers at once.
	// The numbers of a parent include its sub projects (ADR-0034), archived ones too: they are
	// counted as well.
	$effect(() => {
		const projectIds = available.map((project) => project.id);
		if (activeId !== null && !projectIds.includes(activeId)) projectIds.push(activeId);
		for (const id of [...projectIds]) {
			for (const sub of catalog.subProjectsOf(id)) {
				if (!projectIds.includes(sub.id)) projectIds.push(sub.id);
			}
		}
		untrack(() => stats.track(projectIds));
	});

	async function navigate(next: ProjectViewQuery, replaceState = false) {
		await goto(withProjectViewQuery(page.url, next), {
			keepFocus: true,
			noScroll: true,
			replaceState
		});
	}

	async function toggleArchived(event: Event & { currentTarget: HTMLInputElement }) {
		await showArchived(event.currentTarget.checked);
	}

	async function showArchived(on: boolean) {
		await goto(withShowArchived(page.url, on), { keepFocus: true, noScroll: true });
	}

	/**
	 * "Archivierte anzeigen" of the empty state (plan EH-12): the button disappears with the state,
	 * so the focus goes to the heading "Projekte", like after "Suche zurücksetzen".
	 */
	async function showAllArchived() {
		await showArchived(true);
		heading?.focus();
	}

	/**
	 * The layout buttons: the choice is remembered and written to the URL. "Liste" is the default,
	 * so it leaves the parameter out; the remembered choice then says the same.
	 */
	async function chooseLayout(next: ProjectLayout) {
		stored = next;
		writeStoredProjectLayout(storage(), next);
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, layout: next === 'liste' ? null : next });
	}

	/** Column header of the list: natural direction, reversed, by name; back restores it. */
	async function sortBy(key: ProjectSortKey) {
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, sort: nextProjectSort(current.sort, key) });
	}

	/** Text in the search field while it has the focus; else the field shows the URL. */
	let typed = $state<string | null>(null);
	const searchValue = $derived(typed ?? query.search ?? '');

	/** Typing replaces the history entry, so back does not go through every letter. */
	async function search(text: string) {
		typed = text;
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, search: text.trim() === '' ? null : text }, true);
	}

	/** Escape empties a field that is not empty; an empty one leaves Escape to the page. */
	function onSearchKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key !== 'Escape' || event.currentTarget.value === '') return;
		event.preventDefault();
		event.stopPropagation();
		void search('');
	}

	/** "Suche zurücksetzen" of the empty result; the focus goes to the heading. */
	async function clearSearch() {
		typed = null;
		await navigate({ ...query, search: null });
		heading?.focus();
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function linkOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('a[data-project-id]') ?? [])].find(
			(link) => link.dataset.projectId === id
		);
	}

	/** Project whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (×, Escape, blanket, browser back) returns the focus to the row or tile of
	// its project, or to the heading if it is gone (archived, deleted, outside the search).
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(linkOf(previous) ?? heading)?.focus();
		});
	});

	/** Whether the panel "Neues Projekt" was open. */
	let wasCreating = false;

	// Leaving "Neues Projekt" without a project returns the focus to "Neues Projekt".
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (document.getElementById(NEW_PROJECT_LINK_ID) ?? heading)?.focus();
		});
	});

	/** Project whose archiving or restoring from the menu of its row runs (one at a time). */
	let busyId = $state<string | null>(null);
	/** The question of the menu of a row: archiving with active sub projects, or deleting. */
	let asking = $state<{ kind: 'archive' | 'delete'; project: Project } | null>(null);
	let askBusy = $state(false);
	let askError = $state<string | null>(null);

	/** Active sub projects that archiving takes along (only a top-level project has them). */
	function activeSubProjectsOf(project: Project): Project[] {
		if (project.parentId) return [];
		return catalog.subProjectsOf(project.id).filter((sub) => !sub.archived);
	}

	/** The reason of a refused action: its message, else the first field error. */
	function reasonOf<T>(result: EditResult<T>): string | null {
		return result.ok ? null : (result.message ?? Object.values(result.fields)[0] ?? null);
	}

	/**
	 * A row left the list (deleted, archived while archived ones are hidden): the focus goes to the
	 * row that followed it, else the one before, else to the heading, unless it is somewhere else.
	 * A dialog gives it to the heading when its row is gone; the next row is closer.
	 */
	async function keepFocusNear(id: string, order: readonly string[]) {
		await tick();
		if (!focusLost() && document.activeElement !== heading) return;
		const index = order.indexOf(id);
		const near = [id, ...order.slice(index + 1), ...order.slice(0, index).reverse()];
		const link = near.map((other) => linkOf(other)).find((entry) => entry !== undefined);
		(link ?? heading)?.focus();
	}

	/** Archiving or restoring from the menu of a row; a refusal is an error flag with the reason. */
	async function runAction(
		project: Project,
		failure: string,
		action: () => Promise<EditResult<Project>>
	) {
		if (actions === undefined || busyId !== null) return;
		const order = rows.map((row) => row.project.id);
		busyId = project.id;
		try {
			const result = await action();
			const reason = reasonOf(result);
			if (!result.ok && reason !== null) actions.fail(failure, reason);
		} finally {
			busyId = null;
		}
		await keepFocusNear(project.id, order);
	}

	function archive(project: Project) {
		if (actions === undefined) return;
		if (activeSubProjectsOf(project).length > 0) {
			askError = null;
			asking = { kind: 'archive', project };
			return;
		}
		const run = actions;
		void runAction(project, `Projekt „${project.name}“ ließ sich nicht archivieren.`, () =>
			run.archive(project, true)
		);
	}

	function restore(project: Project, archivedParent: Project | null) {
		if (actions === undefined) return;
		const run = actions;
		void runAction(
			project,
			`Projekt „${project.name}“ ließ sich nicht aus dem Archiv holen.`,
			() =>
				archivedParent === null
					? run.archive(project, false)
					: run.restoreWithParent(project, archivedParent)
		);
	}

	/** "Archivieren" or "Endgültig löschen" of the question; a refusal stays in it. */
	async function confirmAsked() {
		const question = asking;
		if (question === null || actions === undefined || askBusy) return;
		const order = rows.map((row) => row.project.id);
		askBusy = true;
		askError = null;
		const result =
			question.kind === 'archive'
				? await actions.archive(question.project, true)
				: await actions.remove(question.project);
		askBusy = false;
		if (result.ok) {
			asking = null;
			// The panel of a deleted project has nothing to show any more.
			if (question.kind === 'delete' && question.project.id === activeId) {
				await goto(projectsViewHref(page.url));
			}
			await keepFocusNear(question.project.id, order);
			return;
		}
		askError = reasonOf(result);
		if (askError === null) asking = null;
	}

	function cancelAsked() {
		if (askBusy) return;
		asking = null;
		askError = null;
	}

	/** The entries of the menu "•••" of a row of the list (AM-4) and of a tile (AM-5). */
	function menuOf(project: Project): MenuAction[] {
		const entries: MenuAction[] = [
			{ label: 'Öffnen', href: projectHref(project.id, page.url) },
			{ label: 'Tickets anzeigen', href: projectTicketsHref(project.id) }
		];
		if (catalog.hierarchyReady && !project.parentId && !project.archived) {
			entries.push({
				label: 'Unterprojekt anlegen',
				href: newSubProjectHref(project.id, page.url)
			});
		}
		if (actions === undefined) return entries;
		const busy = busyId === project.id;
		const parent = project.parentId ? catalog.projectById(project.parentId) : null;
		if (!project.archived) {
			entries.push({
				label: 'Archivieren',
				separated: true,
				dialog: activeSubProjectsOf(project).length > 0,
				busy,
				onselect: () => archive(project)
			});
		} else {
			const archivedParent = parent?.archived ? parent : null;
			entries.push({
				label: archivedParent ? 'Mit Oberprojekt zurückholen' : 'Aus dem Archiv holen',
				separated: true,
				busy,
				onselect: () => restore(project, archivedParent)
			});
		}
		if (canDeleteProject(totalOf(project), catalog.subProjectsOf(project.id))) {
			entries.push({
				label: 'Löschen …',
				dialog: true,
				separated: true,
				locked: busy,
				onselect: () => {
					askError = null;
					asking = { kind: 'delete', project };
				}
			});
		}
		return entries;
	}
</script>

{#snippet newProjectLink(id?: string)}
	<a class="button-primary new" {id} href={newProjectHref(page.url)}>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
		</svg>
		Neues Projekt
	</a>
{/snippet}

<!-- The open tickets below a row of the list (ADR-0034, addendum "Offene Tickets in Projekten"). -->
{#snippet ticketList(project: Project)}
	<ProjectTicketList
		{project}
		tickets={openByProject.get(project.id) ?? []}
		today={tickets.today}
		ownOnly={catalog.subProjectsOf(project.id).length > 0}
		loading={tickets.openState === 'idle' || tickets.openState === 'loading'}
		error={tickets.openState === 'error' ? PROJECT_TICKETS_FAILED : null}
		{rowActions}
		{duplicates}
		returnFocus={() => ticketsToggleOf(project.id)}
	/>
{/snippet}

{#snippet failure(message: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="button-secondary button-small" type="button" onclick={onretry}>
			Erneut versuchen
		</button>
	</div>
{/snippet}

<section class="projects-view" aria-labelledby={ids.heading} bind:this={root}>
	<SectionBar
		title="Projekte"
		headingId={ids.heading}
		count={catalog.state === 'ready' ? matchCount : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="projects" {inboxCount} projectsNewCount={tickets.newInProjects} />
		{/snippet}
		{#snippet end()}
			<div class="search-field">
				<label for={ids.search}>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.25" />
						<path d="M10.25 10.25L13.5 13.5" />
					</svg>
					<span class="visually-hidden">Projekte suchen</span>
				</label>
				<input
					id={ids.search}
					type="search"
					autocomplete="off"
					spellcheck="false"
					placeholder="Name oder Code"
					maxlength={PROJECT_SEARCH_MAX_LENGTH}
					value={searchValue}
					oninput={(event) => void search(event.currentTarget.value)}
					onkeydown={onSearchKeydown}
					onblur={() => (typed = null)}
				/>
			</div>
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					checked={query.showArchived}
					onchange={toggleArchived}
				/>
				Archivierte anzeigen
			</label>
			<div
				class="layout-switch segmented"
				role="group"
				aria-label="Darstellung der Projekte"
				data-tour="project-layout"
			>
				<button
					type="button"
					aria-label="Liste"
					title="Liste"
					aria-pressed={layout === 'liste'}
					onclick={() => void chooseLayout('liste')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
						<path class="dot" d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
					</svg>
				</button>
				<button
					type="button"
					aria-label="Kacheln"
					title="Kacheln"
					aria-pressed={layout === 'kacheln'}
					onclick={() => void chooseLayout('kacheln')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
						<rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
						<rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
						<rect x="9" y="9" width="4.5" height="4.5" rx="1" />
					</svg>
				</button>
			</div>
			{#if layout === 'liste'}
				<ColumnsPopover fit={columnFit} always="Code, Name und Aktionen sind immer sichtbar." />
			{/if}
			{@render newProjectLink(NEW_PROJECT_LINK_ID)}
		{/snippet}
	</SectionBar>

	{#if catalog.state === 'error' && catalog.error}
		{@render failure(catalog.error, () => catalog.reload())}
	{:else if catalog.state !== 'ready'}
		<p class="loading" role="status">Projekte werden geladen …</p>
	{:else}
		{#if tickets.openState === 'error' && tickets.openError}
			{@render failure(tickets.openError, () => tickets.reload())}
		{/if}
		{#if stats.error}
			{@render failure(stats.error, () => stats.reload())}
		{/if}

		{#if rows.length > 0}
			{#if layout === 'liste'}
				<div class="ticket-tools" role="group" aria-labelledby={ids.ticketTools}>
					<span class="ticket-tools-label" id={ids.ticketTools}>Offene Tickets</span>
					<button
						class="button-subtle"
						type="button"
						aria-disabled={allOpen}
						onclick={openAllTickets}
					>
						Alle aufklappen
					</button>
					<button
						class="button-subtle"
						type="button"
						aria-disabled={noneOpen}
						onclick={closeAllTickets}
					>
						Alle zuklappen
					</button>
				</div>
				<ProjectTable
					{rows}
					{activeOf}
					{totalOf}
					{newOf}
					{aggregatedOf}
					{activeId}
					sort={query.sort}
					searching={query.search !== null}
					{columnFit}
					hrefOf={(project) => projectHref(project.id, page.url)}
					{menuOf}
					onsort={(key) => void sortBy(key)}
					ontoggle={toggleFolded}
					{ticketList}
					ticketsOpen={(project) => disclosure.isOpen(project.id)}
					ontoggletickets={(project) => disclosure.toggle(project.id)}
				/>
			{:else}
				<ProjectTiles
					{rows}
					{activeOf}
					{totalOf}
					{activeId}
					{newOf}
					{aggregatedOf}
					hrefOf={(project) => projectHref(project.id, page.url)}
					{menuOf}
					ontoggle={toggleFolded}
				/>
			{/if}
		{:else if catalog.projects.length === 0}
			<EmptyState
				title="Noch keine Projekte"
				description="Ein Projekt fasst Tickets unter einem Code zusammen, etwa HAUS-12."
				icon="projects"
			>
				{#snippet primary()}
					<a class="button-primary" href={newProjectHref(page.url)}>Projekt anlegen</a>
				{/snippet}
			</EmptyState>
		{:else if query.search !== null && available.length > 0}
			<EmptyState
				title="Keine Projekte gefunden"
				description={`Kein Projekt heißt „${query.search}“ oder hat diesen Code.`}
				size="narrow"
				icon="search"
			>
				{#snippet secondary()}
					<button class="button-secondary" type="button" onclick={() => void clearSearch()}>
						Suche zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState
				title="Alle Projekte sind archiviert"
				description="Archivierte Projekte bleiben mit ihren Tickets erhalten und lassen sich einblenden."
				size="narrow"
				icon="projects"
			>
				{#snippet secondary()}
					<button class="button-secondary" type="button" onclick={() => void showAllArchived()}>
						Archivierte anzeigen
					</button>
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</section>

<!-- The questions of the menu of a row or tile (AM-4, AM-5), as in the panel; the view is no modal. -->
{#if asking?.kind === 'archive'}
	{@const project = asking.project}
	<ConfirmDialog
		open
		title={`Projekt „${project.name}“ archivieren?`}
		confirmLabel="Archivieren"
		busy={askBusy}
		error={askError}
		onconfirm={() => void confirmAsked()}
		oncancel={cancelAsked}
	>
		<p>{archiveWithSubProjectsText(activeSubProjectsOf(project))}</p>
	</ConfirmDialog>
{:else if asking?.kind === 'delete'}
	{@const project = asking.project}
	<ConfirmDialog
		open
		title={`Projekt „${project.name}“ löschen?`}
		confirmLabel="Endgültig löschen"
		busy={askBusy}
		error={askError}
		onconfirm={() => void confirmAsked()}
		oncancel={cancelAsked}
	>
		<p>{deleteProjectText(project)}</p>
	</ConfirmDialog>
{/if}

<style>
	.projects-view {
		min-width: 0;
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	/* The search field of base.css, like in the filter bar of "Aufgaben"; here only its width. */
	.search-field input[type='search'] {
		width: 12rem;
		max-width: 100%;
	}

	/* Track, thumb and hover come from .segmented in base.css; here only the icons. */
	.layout-switch svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.layout-switch .dot {
		stroke-width: 2.25;
	}

	/* "Alle aufklappen" and "Alle zuklappen" of the open tickets, above the list. */
	.ticket-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.ticket-tools-label {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.new {
		padding: 0.375rem 0.875rem;
		font-size: var(--font-size-body);
		text-decoration: none;
	}

	.loading {
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

	.failure {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.failure-text {
		flex: 1;
	}
</style>
