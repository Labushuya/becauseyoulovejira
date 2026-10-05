<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		ALL_OPEN_LABEL,
		CARDS_LOCKED_HINT,
		CARD_LABELS,
		FILTER_CARDS,
		cardsLocked,
		chooseAllOpen,
		isAllOpen,
		toggleCard,
		type CardCounts,
		type FilterCard
	} from '$lib/domain/filter-cards';
	import { parseListQuery } from '$lib/domain/list-query';
	import { withListQuery } from '$lib/ticket-links';

	// Filter cards above the list "Aufgaben" (FI-1, ADR-0013 addendum C; before FI-1 the KPI tiles of
	// E3 package 12, ADR-0010): a group of toggles (aria-pressed) with label and number, all used the
	// same way. "Alle offenen" is the base state and pressed while no other card is; a click on it
	// drops the other cards. A click on any other card adds it to the chosen ones or takes it out, the
	// others stay: several cards show their union, each ticket once (domain/filter-cards.ts). The
	// filters and the search of the filter bar stay as they are and narrow the cards. Each number
	// counts the open tickets of the area that pass those filters and the search, regardless of the
	// other cards. Pressed: a checked box, accent surface, frame and a heavier number besides
	// aria-pressed, so the state shows without colour and on a phone; nothing red (ADR-0009).
	// The status filter "Erledigt" leaves no open ticket (PL-1): the cards are locked (aria-disabled,
	// so they stay in the tab order with their description) with the hint "Karten gelten für offene
	// Tickets" below them and as tooltip, "Alle offenen" is not pressed, and chosen cards stay pressed
	// and in the address, so they apply again once the status filter goes.
	let { counts }: { counts: CardCounts | null } = $props();

	interface Card {
		key: 'allOpen' | FilterCard;
		label: string;
	}

	const CARDS: readonly Card[] = [
		{ key: 'allOpen', label: ALL_OPEN_LABEL },
		...FILTER_CARDS.map((card) => ({ key: card, label: CARD_LABELS[card] }))
	];

	const uid = $props.id();
	const lockedHintId = `${uid}-locked-hint`;
	const query = $derived(parseListQuery(page.url.searchParams));
	const locked = $derived(cardsLocked(query));

	function isPressed(card: Card): boolean {
		if (card.key === 'allOpen') return !locked && isAllOpen(query.cards);
		return query.cards.includes(card.key);
	}

	/** What a click does, as the visible line below the number and the description of the card. */
	function hint(card: Card, pressed: boolean): string {
		if (card.key === 'allOpen') {
			return pressed ? 'Keine andere Karte gewählt' : 'Andere Karten aufheben';
		}
		return pressed ? 'Abwählen' : 'Auswählen';
	}

	async function choose(card: Card, pressed: boolean) {
		// Locked cards change nothing; "Alle offenen" without another card: nothing to drop, no
		// history entry.
		if (locked || (card.key === 'allOpen' && pressed)) return;
		const cards = card.key === 'allOpen' ? chooseAllOpen() : toggleCard(query.cards, card.key);
		await goto(withListQuery(page.url, { ...query, cards }), { keepFocus: true, noScroll: true });
	}
</script>

<div class="filter-cards" role="group" aria-label="Filter-Karten">
	{#each CARDS as card (card.key)}
		{@const pressed = isPressed(card)}
		{@const count = counts?.[card.key] ?? null}
		{@const hintId = `${uid}-${card.key}-hint`}
		<button
			class="card"
			type="button"
			data-card={card.key}
			aria-pressed={pressed ? 'true' : 'false'}
			aria-disabled={locked ? 'true' : undefined}
			aria-describedby={locked ? lockedHintId : hintId}
			title={locked ? CARDS_LOCKED_HINT : undefined}
			onclick={() => choose(card, pressed)}
		>
			<span class="label" aria-hidden="true">
				<span class="box">
					{#if pressed}
						<svg class="check" viewBox="0 0 16 16" focusable="false">
							<path d="M3.5 8.5l3 3 6-7" />
						</svg>
					{/if}
				</span>
				{card.label}
			</span>
			<span class="value" aria-hidden="true">{count ?? '–'}</span>
			<span class="visually-hidden">{count === null ? card.label : `${card.label}: ${count}`}</span>
			<!-- Description only (aria-describedby), not part of the name. -->
			{#if !locked}
				<span class="hint" id={hintId} aria-hidden="true">{hint(card, pressed)}</span>
			{/if}
		</button>
	{/each}
	{#if locked}
		<p class="locked-hint" id={lockedHintId}>{CARDS_LOCKED_HINT}</p>
	{/if}
</div>

<style>
	.filter-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		align-items: flex-start;
		padding: 0.75rem 1rem;
		text-align: left;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
		cursor: pointer;
	}

	.card:hover:not([aria-disabled='true']) {
		border-color: var(--color-brand);
	}

	/* Locked (PL-1), like the locked buttons of base.css. */
	.card[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.75;
	}

	.locked-hint {
		grid-column: 1 / -1;
		margin: 0;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.card[aria-pressed='true'] {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.label {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.card[aria-pressed='true'] .label {
		color: inherit;
	}

	/* The box shows that every card is a toggle of its own; checked like the checkboxes of base.css. */
	.box {
		display: inline-grid;
		flex: none;
		place-content: center;
		width: 1rem;
		height: 1rem;
		background: var(--color-surface);
		border: 1.5px solid var(--color-text-muted);
		border-radius: var(--radius-item);
	}

	.card[aria-pressed='true'] .box {
		background: var(--color-brand);
		border-color: var(--color-brand);
	}

	.check {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: var(--color-on-brand);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.value {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.card[aria-pressed='true'] .value {
		font-weight: 700;
	}

	.hint {
		font-size: var(--font-size-caption);
		color: var(--color-text-muted);
	}

	.card[aria-pressed='true'] .hint {
		color: inherit;
	}

	/* Touch screens (UI-1, ADR-0060): a card is at least as high as a button there. */
	@media (pointer: coarse) {
		.card {
			min-height: var(--control-height-touch);
		}
	}

	/*
	 * High contrast: the system draws the surfaces; the check takes the forced colour of the text of
	 * the card, so it stays visible on the system background.
	 */
	@media (forced-colors: active) {
		.check {
			stroke: currentColor;
		}
	}
</style>
