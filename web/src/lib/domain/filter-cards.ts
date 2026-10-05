// Filter cards of "Aufgaben" (FI-1, ADR-0013 addendum C). Pure: the one place of the rules how the
// cards combine. Every card is a toggle; several chosen cards give the union (OR), so a ticket that
// matches several cards counts once. "Alle offenen" is the base state: it stands for "no card", is
// chosen while no other card is, and choosing it drops the others. The detail filters of the filter
// bar (status, priority, due date, project, tag, source, series, search) narrow the union (AND);
// `matchesFilter` (domain/filter.ts) joins both.
//
// The due cards compare like the due filter (`dueBucket` in domain/filter.ts, kept equal by a test):
// "Heute fällig" is the due date today, "Überfällig" a due date before today, never for a done ticket.
// There is no card for done tickets: since ER-1 (ADR-0066) they have the view "Erledigte", and
// "Aufgaben" shows only open work.

import type { CalendarDate } from './berlin-date';
import type { TicketSummary } from './ticket';

/** The cards besides "Alle offenen", in the order they stand. */
export const FILTER_CARDS = ['in_progress', 'due_today', 'overdue', 'urgent'] as const;
export type FilterCard = (typeof FILTER_CARDS)[number];

/** Label of the base state, the card that stands for "no card". */
export const ALL_OPEN_LABEL = 'Alle offenen';

export const CARD_LABELS: Readonly<Record<FilterCard, string>> = Object.freeze({
	in_progress: 'In Arbeit',
	due_today: 'Heute fällig',
	overdue: 'Überfällig',
	urgent: 'Dringend'
});

/** Values of the URL parameter `karte`, German like the other list parameters (ADR-0013 §4). */
export const CARD_URL_VALUES: Readonly<Record<FilterCard, string>> = Object.freeze({
	in_progress: 'in-arbeit',
	due_today: 'heute',
	overdue: 'ueberfaellig',
	urgent: 'dringend'
});

/** What a card looks at. */
export type CardTicket = Pick<TicketSummary, 'status' | 'priority' | 'due'>;

/** True if the ticket belongs to the card at the given Berlin date. */
export function matchesCard(ticket: CardTicket, card: FilterCard, today: CalendarDate): boolean {
	switch (card) {
		case 'in_progress':
			return ticket.status === 'in_progress';
		case 'due_today':
			return ticket.due === today;
		case 'overdue':
			// A done ticket is never overdue (E2 plan, T-14), like the due filter.
			return ticket.due !== null && ticket.due < today && ticket.status !== 'done';
		case 'urgent':
			return ticket.priority === 'urgent';
	}
}

/**
 * The union of the chosen cards: a ticket passes if it belongs to at least one of them, and every
 * ticket passes while none is chosen ("Alle offenen"). A list filtered by it holds every ticket once.
 */
export function matchesCards(
	ticket: CardTicket,
	cards: readonly FilterCard[],
	today: CalendarDate
): boolean {
	return cards.length === 0 || cards.some((card) => matchesCard(ticket, card, today));
}

function isFilterCard(value: string): value is FilterCard {
	return (FILTER_CARDS as readonly string[]).includes(value);
}

/** A selection as it is kept: only known cards, each once, in the order of FILTER_CARDS. */
export function normalizeCards(cards: Iterable<string>): FilterCard[] {
	const chosen = new Set([...cards].filter(isFilterCard));
	return FILTER_CARDS.filter((card) => chosen.has(card));
}

/**
 * Cards of the URL values (`karte=heute&karte=dringend`, a list with commas works as well). Unknown,
 * empty and repeated values are left out, so an old or edited address never fails.
 */
export function cardsFromUrl(values: readonly string[]): FilterCard[] {
	const names = values.flatMap((value) => value.split(','));
	return FILTER_CARDS.filter((card) => names.includes(CARD_URL_VALUES[card]));
}

/** URL values of a selection, in the order of FILTER_CARDS. */
export function cardsToUrl(cards: readonly FilterCard[]): string[] {
	return normalizeCards(cards).map((card) => CARD_URL_VALUES[card]);
}

/** True if both selections hold the same cards. */
export function sameCards(a: readonly FilterCard[], b: readonly FilterCard[]): boolean {
	const left = normalizeCards(a);
	const right = normalizeCards(b);
	return left.length === right.length && left.every((card, index) => card === right[index]);
}

/** "Alle offenen" is chosen while no other card is. */
export function isAllOpen(cards: readonly FilterCard[]): boolean {
	return cards.length === 0;
}

/** A click on a card: it joins or leaves the selection, the other cards stay. */
export function toggleCard(cards: readonly FilterCard[], card: FilterCard): FilterCard[] {
	return cards.includes(card)
		? normalizeCards(cards.filter((chosen) => chosen !== card))
		: normalizeCards([...cards, card]);
}

/** A click on "Alle offenen": no card is chosen any more. */
export function chooseAllOpen(): FilterCard[] {
	return [];
}

/** True if a chosen card compares the due date with today (the done section loads again at midnight). */
export function cardsUseToday(cards: readonly FilterCard[]): boolean {
	return cards.includes('due_today') || cards.includes('overdue');
}

/** Number of each card; `allOpen` is the number of "Alle offenen". */
export type CardCounts = { allOpen: number } & Record<FilterCard, number>;

/**
 * Numbers of the cards over the given tickets, which the list passes already narrowed by the area
 * and the detail filters: each card counts its own tickets, regardless of the other cards. Done
 * tickets never count.
 */
export function countCards(tickets: Iterable<CardTicket>, today: CalendarDate): CardCounts {
	const counts: CardCounts = { allOpen: 0, in_progress: 0, due_today: 0, overdue: 0, urgent: 0 };
	for (const ticket of tickets) {
		if (ticket.status === 'done') continue;
		counts.allOpen += 1;
		for (const card of FILTER_CARDS) {
			if (matchesCard(ticket, card, today)) counts[card] += 1;
		}
	}
	return counts;
}

/** Labels of the chosen cards, or "Alle offenen" without one. */
export function cardsLabel(cards: readonly FilterCard[]): string {
	const chosen = normalizeCards(cards);
	return chosen.length === 0 ? ALL_OPEN_LABEL : chosen.map((card) => CARD_LABELS[card]).join(', ');
}

/** What the summary above the list counts. */
export interface SummaryCount {
	count: number;
	/** A detail filter or the search narrows the cards as well. */
	filtered?: boolean;
}

/**
 * Summary above the list: "12 Tickets aus: In Arbeit, Heute fällig, Dringend", with "– weitere
 * Filter aktiv" while a detail filter or the search narrows it.
 */
export function cardSummary(
	cards: readonly FilterCard[],
	{ count, filtered = false }: SummaryCount
): string {
	const amount = count === 1 ? '1 Ticket' : `${count} Tickets`;
	return `${amount} aus: ${cardsLabel(cards)}${filtered ? ' – weitere Filter aktiv' : ''}`;
}
