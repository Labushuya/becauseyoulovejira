<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SORT_COLUMN_LABELS, sortOrderLabel } from '$lib/domain/labels';
	import { parseListQuery, type ListQuery } from '$lib/domain/list-query';
	import { SORT_KEYS, chooseSortKey, type SortKey } from '$lib/domain/ordering';
	import { findAssignees } from '$lib/stores/assignees.svelte';
	import { withListQuery } from '$lib/ticket-links';
	import ChipGroup from './ChipGroup.svelte';

	// "Sortieren nach" in the filter sheet of the phone frame (MO-3, ADR-0073 addendum MO-3; concept
	// MO-0 §3.2): the cards of "Aufgaben" have no column headers to click, so the sort of the table
	// (T-5, URL parameter `sort`) is a choice of its own here. Two chip groups: the column ("Standard"
	// is the default order) and, once one is chosen, its direction in words ("Dringend zuerst" or
	// "Niedrig zuerst", the natural direction first, like the first click on a header). Every choice
	// is a navigation with a history entry like a click on a header, so back restores the previous
	// sort. "Zuständig" only in a household, or while the address sorts by it (like "Gruppieren").
	let {
		household
	}: {
		/** The area of the tab is the household; without it the directory of the layout decides. */
		household?: boolean;
	} = $props();

	type Direction = 'natural' | 'reversed';

	const uid = $props.id();
	const assignees = findAssignees();
	const query = $derived(parseListQuery(page.url.searchParams));
	const sort = $derived(query.sort);
	const inHousehold = $derived(
		(household ?? assignees?.active ?? false) || sort?.key === 'assignee'
	);
	const keyOptions = $derived(
		SORT_KEYS.filter((key) => key !== 'assignee' || inHousehold).map((key) => ({
			value: key,
			label: SORT_COLUMN_LABELS[key]
		}))
	);
	const directionOptions = $derived(
		sort === null
			? []
			: (['natural', 'reversed'] as const).map((value) => ({
					value,
					label: sortOrderLabel({ key: sort.key, reversed: value === 'reversed' })
				}))
	);

	async function navigate(next: ListQuery) {
		await goto(withListQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	function chooseKey(key: SortKey | null) {
		const current = parseListQuery(page.url.searchParams);
		void navigate({ ...current, sort: chooseSortKey(current.sort, key) });
	}

	function chooseDirection(direction: Direction | null) {
		const current = parseListQuery(page.url.searchParams);
		if (current.sort === null || direction === null) return;
		void navigate({
			...current,
			sort: { key: current.sort.key, reversed: direction === 'reversed' }
		});
	}
</script>

<div class="sort-choice">
	<ChipGroup
		legend="Sortieren nach"
		name={`${uid}-sort`}
		options={keyOptions}
		value={sort?.key ?? null}
		all="Standard"
		onchange={chooseKey}
	/>
	{#if sort !== null}
		<ChipGroup
			legend="Reihenfolge"
			name={`${uid}-direction`}
			options={directionOptions}
			value={sort.reversed ? 'reversed' : 'natural'}
			all={null}
			onchange={chooseDirection}
		/>
	{/if}
</div>

<style>
	/* Only in the filter sheet of the phone frame (MO-3): the two groups below each other. */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .sort-choice {
			display: grid;
			gap: 1rem;
		}
	}
</style>
