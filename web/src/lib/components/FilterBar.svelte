<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PRIORITY_LABELS, STATUS_LABELS } from '$lib/domain/labels';
	import {
		DUE_FILTERS,
		NO_PROJECT,
		hasFilters,
		parseListQuery,
		resetFilters,
		withFilter,
		type DueFilter,
		type FilterKey,
		type ListQuery
	} from '$lib/domain/list-query';
	import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/domain/status';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { withListQuery } from '$lib/ticket-links';
	import ChipGroup from './ChipGroup.svelte';

	// Filter bar (E3 plan, T-6 and package 10; ADR-0010 section 1): chip groups for status,
	// priority and due date, selects for project and tag, and "Zurücksetzen". The state lives only
	// in the URL (ADR-0013 section 4): every change navigates with a history entry, so reload,
	// back and forward keep it; opening a ticket keeps it because links carry the query.
	let { catalog }: { catalog: CatalogStore } = $props();

	const uid = $props.id();
	const ids = {
		project: `${uid}-project`,
		tag: `${uid}-tag`,
		resetHint: `${uid}-reset-hint`
	};

	const DUE_LABELS: Readonly<Record<DueFilter, string>> = {
		overdue: 'Überfällig',
		today: 'Heute',
		soon: 'Bald',
		none: 'Ohne Datum'
	};

	const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
	// Urgent first, like the priority order of the table.
	const priorityOptions = [...PRIORITIES]
		.reverse()
		.map((value) => ({ value, label: PRIORITY_LABELS[value] }));
	const dueOptions = DUE_FILTERS.map((value) => ({ value, label: DUE_LABELS[value] }));

	const query = $derived(parseListQuery(page.url.searchParams));
	const filtered = $derived(hasFilters(query));
	const activeProjects = $derived(catalog.projects.filter((project) => !project.archived));
	const archivedProjects = $derived(catalog.projects.filter((project) => project.archived));
	/** A project or tag in the URL the catalog does not know (foreign, deleted or mistyped). */
	const unknownProject = $derived(
		query.project !== null && query.project !== NO_PROJECT && !catalog.projectById(query.project)
	);
	const unknownTag = $derived(query.tag !== null && !catalog.tagById(query.tag));
	const unknownLabel = $derived(catalog.state === 'ready' ? 'Unbekannt' : 'Wird geladen …');

	async function navigate(next: ListQuery) {
		await goto(withListQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	function setFilter<K extends FilterKey>(key: K, value: ListQuery[K]) {
		void navigate(withFilter(query, key, value));
	}

	function reset() {
		if (filtered) void navigate(resetFilters(query));
	}
</script>

<section class="filter-bar" aria-label="Filter">
	<ChipGroup
		legend="Status"
		name={`${uid}-status`}
		options={statusOptions}
		value={query.status}
		onchange={(value: Status | null) => setFilter('status', value)}
	/>
	<ChipGroup
		legend="Priorität"
		name={`${uid}-priority`}
		options={priorityOptions}
		value={query.priority}
		onchange={(value: Priority | null) => setFilter('priority', value)}
	/>
	<ChipGroup
		legend="Fällig"
		name={`${uid}-due`}
		options={dueOptions}
		value={query.due}
		onchange={(value: DueFilter | null) => setFilter('due', value)}
	/>

	<div class="selects">
		<label class="select" for={ids.project}>
			<span class="select-label">Projekt</span>
			<select
				id={ids.project}
				onchange={(event) => setFilter('project', event.currentTarget.value || null)}
			>
				<option value="" selected={query.project === null}>Alle</option>
				<option value={NO_PROJECT} selected={query.project === NO_PROJECT}>Ohne Projekt</option>
				{#each activeProjects as project (project.id)}
					<option value={project.id} selected={query.project === project.id}>
						{project.name} ({project.code})
					</option>
				{/each}
				{#if archivedProjects.length > 0}
					<optgroup label="Archiviert">
						{#each archivedProjects as project (project.id)}
							<option value={project.id} selected={query.project === project.id}>
								{project.name} ({project.code})
							</option>
						{/each}
					</optgroup>
				{/if}
				{#if unknownProject && query.project !== null}
					<option value={query.project} selected>{unknownLabel}</option>
				{/if}
			</select>
		</label>

		<label class="select" for={ids.tag}>
			<span class="select-label">Tag</span>
			<select
				id={ids.tag}
				onchange={(event) => setFilter('tag', event.currentTarget.value || null)}
			>
				<option value="" selected={query.tag === null}>Alle</option>
				{#each catalog.tags as tag (tag.id)}
					<option value={tag.id} selected={query.tag === tag.id}>{tag.name}</option>
				{/each}
				{#if unknownTag && query.tag !== null}
					<option value={query.tag} selected>{unknownLabel}</option>
				{/if}
			</select>
		</label>

		<button
			class="reset"
			type="button"
			aria-disabled={filtered ? undefined : 'true'}
			aria-describedby={filtered ? undefined : ids.resetHint}
			onclick={reset}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" />
			</svg>
			Zurücksetzen
		</button>
		{#if !filtered}
			<span class="visually-hidden" id={ids.resetHint}>Kein Filter gesetzt.</span>
		{/if}
	</div>
</section>

<style>
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem 1.25rem;
		align-items: center;
		margin-bottom: 1.25rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	.selects {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.select {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
	}

	.select-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	select {
		max-width: 14rem;
		padding: 0.1875rem 0.375rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	.reset {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.1875rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.reset[aria-disabled='true'] {
		color: var(--color-text-muted);
		cursor: not-allowed;
	}

	.reset svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
