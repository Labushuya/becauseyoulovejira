// Filter cards of "Aufgaben" (FI-1, ADR-0013 addendum C): the union of the chosen cards without
// duplicates, "Alle offenen", toggling without resetting each other, the URL values, the numbers
// per card and the summary above the list.

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import { dueBucket, matchesFilter, type FilterableTicket } from './filter';
import {
	ALL_OPEN_LABEL,
	CARD_LABELS,
	FILTER_CARDS,
	cardSummary,
	cardsFromUrl,
	cardsLabel,
	cardsToUrl,
	cardsUseToday,
	chooseAllOpen,
	countCards,
	isAllOpen,
	matchesCard,
	matchesCards,
	normalizeCards,
	sameCards,
	toggleCard,
	type FilterCard
} from './filter-cards';
import { EMPTY_LIST_QUERY, type ListQuery } from './list-query';
import { STATUSES } from './status';

const TODAY = '2026-09-25';
const HOUSE = 'p00000000000001';

interface Row extends FilterableTicket {
	id: string;
}

let sequence = 0;

function ticket(overrides: Partial<Row> = {}): Row {
	sequence += 1;
	return {
		id: `t${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		source: null,
		recurring: false,
		...overrides
	};
}

/** Every subset of the cards, the empty one ("Alle offenen") first. */
function allSelections(): FilterCard[][] {
	return Array.from({ length: 2 ** FILTER_CARDS.length }, (_, mask) =>
		FILTER_CARDS.filter((_card, index) => (mask & (2 ** index)) !== 0)
	);
}

/**
 * Tickets for every card and their overlaps: in progress, due today, overdue and urgent alone,
 * pairs, all four at once, none of them, and done ones.
 */
function matrix(): Row[] {
	return [
		ticket({ status: 'in_progress' }),
		ticket({ due: TODAY }),
		ticket({ due: addDays(TODAY, -3) }),
		ticket({ priority: 'urgent' }),
		ticket({ status: 'in_progress', priority: 'urgent' }),
		ticket({ due: TODAY, priority: 'urgent' }),
		ticket({ status: 'in_progress', due: addDays(TODAY, -1) }),
		ticket({ status: 'in_progress', due: TODAY, priority: 'urgent' }),
		ticket({ status: 'waiting', due: addDays(TODAY, 2) }),
		ticket({ status: 'backlog', priority: 'high' }),
		ticket({ status: 'done', due: addDays(TODAY, -2), priority: 'urgent' }),
		ticket({ status: 'done', due: TODAY })
	];
}

/** Reference: the tickets of each card one after another, then every ID once in list order. */
function referenceUnion(tickets: readonly Row[], cards: readonly FilterCard[]): string[] {
	if (cards.length === 0) return tickets.map((entry) => entry.id);
	const ids = new Set(
		cards.flatMap((card) =>
			tickets.filter((entry) => matchesCard(entry, card, TODAY)).map((entry) => entry.id)
		)
	);
	return tickets.filter((entry) => ids.has(entry.id)).map((entry) => entry.id);
}

describe('matchesCard', () => {
	it('"In Arbeit" takes the status in progress only', () => {
		for (const status of STATUSES) {
			expect(matchesCard(ticket({ status }), 'in_progress', TODAY), status).toBe(
				status === 'in_progress'
			);
		}
	});

	it('"Dringend" takes the priority urgent of every status', () => {
		expect(matchesCard(ticket({ priority: 'urgent' }), 'urgent', TODAY)).toBe(true);
		expect(matchesCard(ticket({ priority: 'urgent', status: 'backlog' }), 'urgent', TODAY)).toBe(
			true
		);
		expect(matchesCard(ticket({ priority: 'high' }), 'urgent', TODAY)).toBe(false);
	});

	it('draws the due cards at today and yesterday, like the due filter', () => {
		for (let offset = -40; offset <= 10; offset += 1) {
			const due = addDays(TODAY, offset);
			const bucket = dueBucket(due, TODAY);
			expect(matchesCard(ticket({ due }), 'due_today', TODAY), due).toBe(bucket === 'today');
			expect(matchesCard(ticket({ due }), 'overdue', TODAY), due).toBe(bucket === 'overdue');
		}
		expect(matchesCard(ticket(), 'due_today', TODAY)).toBe(false);
		expect(matchesCard(ticket(), 'overdue', TODAY)).toBe(false);
	});

	it('never takes a done ticket as overdue, but as due today', () => {
		const late = ticket({ status: 'done', due: addDays(TODAY, -1) });
		expect(matchesCard(late, 'overdue', TODAY)).toBe(false);
		expect(matchesCard(ticket({ status: 'done', due: TODAY }), 'due_today', TODAY)).toBe(true);
	});

	it('follows the Berlin date', () => {
		const due = ticket({ due: '2026-09-25' });
		expect(matchesCard(due, 'due_today', '2026-09-25')).toBe(true);
		expect(matchesCard(due, 'overdue', '2026-09-26')).toBe(true);
		expect(matchesCard(due, 'due_today', '2026-09-26')).toBe(false);
	});
});

describe('matchesCards: the union of the chosen cards', () => {
	it('lets every ticket pass with "Alle offenen" (no card)', () => {
		for (const entry of matrix()) expect(matchesCards(entry, [], TODAY)).toBe(true);
	});

	it.each(allSelections().map((cards) => [cards.join('+') || 'Alle offenen', cards] as const))(
		'%s: every ticket of a chosen card, each once and in the order of the list',
		(_name, cards) => {
			const tickets = matrix();
			const shown = tickets.filter((entry) => matchesCards(entry, cards, TODAY));
			const ids = shown.map((entry) => entry.id);
			expect(ids).toEqual(referenceUnion(tickets, cards));
			expect(new Set(ids).size).toBe(ids.length);
		}
	);

	it('shows a ticket of three cards once: the sum without duplicates', () => {
		const all = ticket({ status: 'in_progress', due: TODAY, priority: 'urgent' });
		const working = ticket({ status: 'in_progress' });
		const urgent = ticket({ priority: 'urgent' });
		const other = ticket({ status: 'waiting' });
		const cards: FilterCard[] = ['in_progress', 'due_today', 'urgent'];
		const shown = [all, working, urgent, other].filter((entry) =>
			matchesCards(entry, cards, TODAY)
		);

		expect(shown).toEqual([all, working, urgent]);
		// The numbers of the cards add up to more, because `all` counts on each of the three.
		const counts = countCards([all, working, urgent, other], TODAY);
		expect(counts.in_progress + counts.due_today + counts.urgent).toBe(5);
	});

	it('takes "Heute fällig" and "Überfällig" together', () => {
		const late = ticket({ due: addDays(TODAY, -4) });
		const due = ticket({ due: TODAY });
		const later = ticket({ due: addDays(TODAY, 1) });
		const shown = [late, due, later, ticket()].filter((entry) =>
			matchesCards(entry, ['due_today', 'overdue'], TODAY)
		);
		expect(shown).toEqual([late, due]);
	});

	it('is narrowed by the detail filters (AND) in matchesFilter', () => {
		const query = (overrides: Partial<ListQuery>): ListQuery => ({
			...EMPTY_LIST_QUERY,
			...overrides
		});
		const inHouse = ticket({ status: 'in_progress', projectId: HOUSE });
		const urgentHouse = ticket({ priority: 'urgent', projectId: HOUSE });
		const urgentElsewhere = ticket({ priority: 'urgent' });
		const quiet = ticket({ projectId: HOUSE });
		const tickets = [inHouse, urgentHouse, urgentElsewhere, quiet];
		const shown = (overrides: Partial<ListQuery>) =>
			tickets.filter((entry) => matchesFilter(entry, query(overrides), TODAY));

		expect(shown({ cards: ['in_progress', 'urgent'] })).toEqual([
			inHouse,
			urgentHouse,
			urgentElsewhere
		]);
		expect(shown({ cards: ['in_progress', 'urgent'], project: HOUSE })).toEqual([
			inHouse,
			urgentHouse
		]);
		expect(shown({ cards: ['in_progress', 'urgent'], priority: 'urgent' })).toEqual([
			urgentHouse,
			urgentElsewhere
		]);
		// A detail filter that contradicts every chosen card leaves nothing, as AND demands.
		expect(shown({ cards: ['in_progress'], status: 'open' })).toEqual([]);
		expect(shown({ project: HOUSE })).toEqual([inHouse, urgentHouse, quiet]);
	});
});

describe('choosing cards', () => {
	it('adds a card to the chosen ones and takes it out again, the others stay', () => {
		expect(toggleCard([], 'urgent')).toEqual(['urgent']);
		expect(toggleCard(['urgent'], 'in_progress')).toEqual(['in_progress', 'urgent']);
		expect(toggleCard(['in_progress', 'urgent'], 'due_today')).toEqual([
			'in_progress',
			'due_today',
			'urgent'
		]);
		expect(toggleCard(['in_progress', 'due_today', 'urgent'], 'due_today')).toEqual([
			'in_progress',
			'urgent'
		]);
		expect(toggleCard(['urgent'], 'urgent')).toEqual([]);
	});

	it('lets "Heute fällig" and "Überfällig" stand side by side', () => {
		const both = toggleCard(toggleCard([], 'due_today'), 'overdue');
		expect(both).toEqual(['due_today', 'overdue']);
		expect(toggleCard(both, 'due_today')).toEqual(['overdue']);
	});

	it('takes "Alle offenen" as no card: chosen while none is, choosing it drops every card', () => {
		expect(isAllOpen([])).toBe(true);
		expect(isAllOpen(['overdue'])).toBe(false);
		expect(chooseAllOpen()).toEqual([]);
		expect(isAllOpen(toggleCard(['overdue'], 'overdue'))).toBe(true);
	});

	it('keeps a selection in a fixed order with every card once and only known cards', () => {
		expect(normalizeCards(['urgent', 'in_progress', 'urgent', 'done', 'all'])).toEqual([
			'in_progress',
			'urgent'
		]);
		expect(normalizeCards([])).toEqual([]);
		expect(sameCards(['urgent', 'overdue'], ['overdue', 'urgent'])).toBe(true);
		expect(sameCards(['urgent'], ['urgent', 'overdue'])).toBe(false);
		expect(sameCards([], [])).toBe(true);
	});

	it('knows which cards compare with today', () => {
		expect(cardsUseToday(['in_progress', 'urgent'])).toBe(false);
		expect(cardsUseToday(['due_today'])).toBe(true);
		expect(cardsUseToday(['overdue', 'urgent'])).toBe(true);
	});
});

describe('URL values of the cards', () => {
	it('reads one value per card, also as a list with commas', () => {
		expect(cardsFromUrl(['in-arbeit', 'dringend'])).toEqual(['in_progress', 'urgent']);
		expect(cardsFromUrl(['heute,ueberfaellig'])).toEqual(['due_today', 'overdue']);
		expect(cardsFromUrl(['dringend', 'heute'])).toEqual(['due_today', 'urgent']);
	});

	it('leaves out unknown, empty and repeated values instead of failing', () => {
		expect(cardsFromUrl(['heute', 'heute', 'morgen', '', 'Dringend', 'urgent'])).toEqual([
			'due_today'
		]);
		expect(cardsFromUrl([])).toEqual([]);
	});

	it('writes the values in the fixed order', () => {
		expect(cardsToUrl(['urgent', 'in_progress', 'overdue', 'due_today'])).toEqual([
			'in-arbeit',
			'heute',
			'ueberfaellig',
			'dringend'
		]);
		for (const cards of allSelections()) expect(cardsFromUrl(cardsToUrl(cards))).toEqual(cards);
	});
});

describe('countCards', () => {
	it('counts nothing without tickets', () => {
		expect(countCards([], TODAY)).toEqual({
			allOpen: 0,
			in_progress: 0,
			due_today: 0,
			overdue: 0,
			urgent: 0
		});
	});

	it('never counts done tickets', () => {
		const done = ticket({ status: 'done', priority: 'urgent', due: TODAY });
		expect(countCards([done, { ...done, due: addDays(TODAY, -3) }], TODAY)).toEqual({
			allOpen: 0,
			in_progress: 0,
			due_today: 0,
			overdue: 0,
			urgent: 0
		});
	});

	it('counts each card on its own, regardless of the other cards', () => {
		expect(countCards(matrix(), TODAY)).toEqual({
			allOpen: 10,
			in_progress: 4,
			due_today: 3,
			overdue: 2,
			urgent: 4
		});
	});

	it('counts exactly the tickets each card shows alone', () => {
		const open = matrix().filter((entry) => entry.status !== 'done');
		const counts = countCards(open, TODAY);
		expect(counts.allOpen).toBe(open.filter((entry) => matchesCards(entry, [], TODAY)).length);
		for (const card of FILTER_CARDS) {
			expect(counts[card], card).toBe(
				open.filter((entry) => matchesCards(entry, [card], TODAY)).length
			);
		}
	});

	it('follows the Berlin date', () => {
		const due = [ticket({ due: '2026-09-25' })];
		expect(countCards(due, '2026-09-25')).toMatchObject({ due_today: 1, overdue: 0 });
		expect(countCards(due, '2026-09-26')).toMatchObject({ due_today: 0, overdue: 1 });
	});
});

describe('summary above the list', () => {
	it('names the chosen cards in their order', () => {
		expect(cardSummary(['in_progress', 'due_today', 'urgent'], { count: 12 })).toBe(
			'12 Tickets aus: In Arbeit, Heute fällig, Dringend'
		);
		expect(cardSummary(['urgent'], { count: 1 })).toBe('1 Ticket aus: Dringend');
		expect(cardSummary(['overdue'], { count: 0 })).toBe('0 Tickets aus: Überfällig');
	});

	it('names "Alle offenen" without a card', () => {
		expect(cardsLabel([])).toBe(ALL_OPEN_LABEL);
		expect(cardSummary([], { count: 3 })).toBe('3 Tickets aus: Alle offenen');
	});

	it('says when filters narrow the cards and when more tickets match', () => {
		expect(cardSummary(['due_today', 'overdue'], { count: 4, filtered: true })).toBe(
			'4 Tickets aus: Heute fällig, Überfällig – weitere Filter aktiv'
		);
		expect(cardSummary(['urgent'], { count: 50, more: true })).toBe(
			'Mehr als 50 Tickets aus: Dringend'
		);
	});

	it('has a label for every card', () => {
		expect(FILTER_CARDS.map((card) => CARD_LABELS[card])).toEqual([
			'In Arbeit',
			'Heute fällig',
			'Überfällig',
			'Dringend'
		]);
	});
});
