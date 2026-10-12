<script lang="ts" generics="T">
	import { tick, untrack, type Snippet } from 'svelte';
	import {
		isPaged,
		pageButtonRest,
		pageCount,
		pageSlice,
		pageText,
		shownPage,
		totalText,
		type PagedNoun
	} from '$lib/domain/paged-list';

	// A list in pages of PAGE_SIZE entries (TD-1, ADR-0031 addendum L): the sources of a ticket, its
	// source tickets and its follow-ups. Up to PAGE_SIZE entries it is a plain list; above that the
	// controls follow below it: "‹ Zurück", "Seite 2 von 3 · 12 Quellen", "Weiter ›". The names of the
	// buttons start with their visible word and name the list ("Zurück zur vorherigen Seite der
	// Quellen"), at the ends they are aria-disabled and stay focusable. A change of the page puts the
	// focus on the first entry of the new page and says "Seite 2 von 3" in a polite status region.
	// A new `resetKey` (another ticket) starts on page 1 again. The entry named by `hold` keeps its
	// page in view while the list changes around it (an action unfolded below it); changing the page
	// by hand tells the owner through `onpagechange`, who then lets go of it. When an entry leaves
	// and its page becomes empty, the list shows the page before and says so; a focus lost with the
	// entry goes to the start of that page. `row` renders the inside of an entry.
	let {
		items,
		key,
		label,
		noun,
		resetKey,
		hold = null,
		compact = false,
		onpagechange,
		row
	}: {
		items: readonly T[];
		/** Stable key of an entry. */
		key: (item: T) => string;
		/** Name of the list, e.g. "Quellen aus dem Eingang". */
		label: string;
		/** Name of the entries for the count and the buttons, e.g. { one: 'Quelle', other: 'Quellen' }. */
		noun: PagedNoun;
		/** The list belongs to this (the ticket): a new one starts on page 1. */
		resetKey: string;
		/** Key of an entry whose page stays shown while the list changes; null for none. */
		hold?: string | null;
		/** Less space between the entries (one-line entries). */
		compact?: boolean;
		/** Called after the user changed the page, with the new page (from 0). */
		onpagechange?: (page: number) => void;
		row: Snippet<[T]>;
	} = $props();

	/** The page the user chose, for the list it was chosen in. */
	let chosen = $state<{ scope: string; page: number }>({ scope: '', page: 0 });
	/** The last change of the page said aloud, for the list it belongs to. */
	let said = $state<{ scope: string; text: string }>({ scope: '', text: '' });
	let list = $state<HTMLUListElement>();

	const count = $derived(pageCount(items.length));
	const held = $derived(hold === null ? -1 : items.findIndex((item) => key(item) === hold));
	const page = $derived(
		shownPage({
			total: items.length,
			chosen: chosen.scope === resetKey ? chosen.page : 0,
			held
		})
	);
	const shown = $derived(pageSlice(items, page));
	const paged = $derived(isPaged(items.length));
	const announcement = $derived(said.scope === resetKey ? said.text : '');

	function say(target: number, pages: number) {
		said = { scope: resetKey, text: pages > 1 ? pageText(target, pages) : '' };
	}

	/** The first entry of the shown page, which takes the focus after a change of the page. */
	function focusStart() {
		list?.querySelector<HTMLElement>(':scope > li')?.focus();
	}

	async function go(step: -1 | 1) {
		const target = page + step;
		if (target < 0 || target >= count) return;
		chosen = { scope: resetKey, page: target };
		say(target, count);
		onpagechange?.(target);
		await tick();
		focusStart();
	}

	// The list itself moved the page: to the page of the held entry, or back from a page that
	// became empty. The page is kept as the chosen one, so the list does not jump back when it grows
	// again. Only the page that became empty is said aloud, and only then the focus moves, if it was
	// lost with the entry that left (a move to the page of the held entry is quiet).
	$effect(() => {
		const current = page;
		untrack(() => {
			const sameList = chosen.scope === resetKey;
			if (sameList && chosen.page === current) return;
			chosen = { scope: resetKey, page: current };
			if (!sameList || held >= 0) return;
			say(current, count);
			const active = document.activeElement;
			if (active === null || active === document.body) void tick().then(focusStart);
		});
	});
</script>

<ul class="paged-list" class:compact aria-label={label} bind:this={list}>
	{#each shown as item (key(item))}
		<!-- Focusable by code only: the first entry takes the focus after a change of the page. -->
		<li tabindex="-1">{@render row(item)}</li>
	{/each}
</ul>
{#if paged}
	<div class="pager" role="group" aria-label={`Seiten der ${noun.other}`}>
		<button
			class="button-subtle button-small"
			type="button"
			aria-disabled={page === 0 ? 'true' : undefined}
			onclick={() => void go(-1)}
		>
			<!-- The space stands outside the hidden text: the computation of a name drops white space at
			the edges of a child element (see NewTabHint). -->
			<span aria-hidden="true">‹</span>
			Zurück <span class="visually-hidden">{pageButtonRest('previous', noun)}</span>
		</button>
		<p class="position">
			{pageText(page, count)} <span class="total">· {totalText(items.length, noun)}</span>
		</p>
		<button
			class="button-subtle button-small"
			type="button"
			aria-disabled={page >= count - 1 ? 'true' : undefined}
			onclick={() => void go(1)}
		>
			Weiter <span class="visually-hidden">{pageButtonRest('next', noun)}</span>
			<span aria-hidden="true">›</span>
		</button>
	</div>
{/if}
<p class="visually-hidden" role="status">{announcement}</p>

<style>
	.paged-list {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.paged-list.compact {
		gap: 0.375rem;
	}

	li {
		min-width: 0;
		border-radius: var(--radius-control);
	}

	.pager {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
	}

	.position {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
