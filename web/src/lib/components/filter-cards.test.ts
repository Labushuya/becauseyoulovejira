// Component tests for the filter cards (FI-1, ADR-0013 addendum C; before the KPI tiles of E3
// package 12): five toggles with label and number, "Alle offenen" as base state, toggling without
// resetting other cards, "Heute fällig" together with "Überfällig", the detail filters kept, and
// old addresses. SvelteKit navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardCounts } from '$lib/domain/filter-cards';
import FilterCards from './FilterCards.svelte';
import source from './FilterCards.svelte?raw';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const COUNTS: CardCounts = {
	allOpen: 12,
	in_progress: 3,
	due_today: 2,
	overdue: 4,
	urgent: 1,
	mine: 5
};
const NAVIGATION = { keepFocus: true, noScroll: true };

function show(path = '/', counts: CardCounts | null = COUNTS) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	return render(FilterCards, { props: { counts } });
}

function card(name: string) {
	return screen.getByRole('button', { name });
}

function hintOf(button: HTMLElement) {
	return document.getElementById(String(button.getAttribute('aria-describedby')))?.textContent;
}

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('filter cards', () => {
	it('shows five toggles with label and number as their name', () => {
		show();

		const group = screen.getByRole('group', { name: 'Filter-Karten' });
		const buttons = within(group).getAllByRole('button');
		expect(buttons.map((button) => button.getAttribute('type'))).toEqual(Array(5).fill('button'));
		expect(buttons.every((button) => button.hasAttribute('aria-pressed'))).toBe(true);
		for (const name of [
			'Alle offenen: 12',
			'In Arbeit: 3',
			'Heute fällig: 2',
			'Überfällig: 4',
			'Dringend: 1'
		]) {
			expect(card(name)).toBeTruthy();
		}
		expect(card('Überfällig: 4').querySelector('.value')?.textContent).toBe('4');
		// Every card shows the box of a toggle, checked only when pressed.
		expect(group.querySelectorAll('.box')).toHaveLength(5);
	});

	it('shows no numbers while the list is not loaded', () => {
		show('/', null);

		expect(card('Alle offenen').querySelector('.value')?.textContent).toBe('–');
		expect(card('Überfällig')).toBeTruthy();
	});

	it('presses "Alle offenen" while no other card is chosen, also with filters', () => {
		show('/?prio=high&q=Miete&sort=titel');

		const allOpen = card('Alle offenen: 12');
		expect(allOpen.getAttribute('aria-pressed')).toBe('true');
		expect(allOpen.querySelector('svg.check')).not.toBeNull();
		expect(hintOf(allOpen)).toBe('Keine andere Karte gewählt');
		for (const name of ['In Arbeit: 3', 'Heute fällig: 2', 'Überfällig: 4', 'Dringend: 1']) {
			expect(card(name).getAttribute('aria-pressed')).toBe('false');
			expect(card(name).querySelector('svg.check')).toBeNull();
			expect(hintOf(card(name))).toBe('Auswählen');
		}
	});

	it('presses every chosen card and nothing else', () => {
		show('/?karte=in-arbeit&karte=heute&karte=dringend');

		expect(card('Alle offenen: 12').getAttribute('aria-pressed')).toBe('false');
		expect(hintOf(card('Alle offenen: 12'))).toBe('Andere Karten aufheben');
		for (const name of ['In Arbeit: 3', 'Heute fällig: 2', 'Dringend: 1']) {
			expect(card(name).getAttribute('aria-pressed')).toBe('true');
			expect(card(name).querySelector('svg.check')).not.toBeNull();
			expect(hintOf(card(name))).toBe('Abwählen');
		}
		expect(card('Überfällig: 4').getAttribute('aria-pressed')).toBe('false');
	});

	it.each([
		['In Arbeit: 3', '/', '/?karte=in-arbeit'],
		['Dringend: 1', '/?karte=in-arbeit', '/?karte=in-arbeit&karte=dringend'],
		[
			'Heute fällig: 2',
			'/?karte=in-arbeit&karte=dringend',
			'/?karte=in-arbeit&karte=heute&karte=dringend'
		],
		['Überfällig: 4', '/?karte=heute', '/?karte=heute&karte=ueberfaellig'],
		['Heute fällig: 2', '/?karte=ueberfaellig', '/?karte=heute&karte=ueberfaellig']
	])('%s joins the chosen cards (%s → %s)', async (name, from, to) => {
		show(from);

		await fireEvent.click(card(name));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(to, NAVIGATION);
	});

	it('takes a pressed card out and leaves the other cards', async () => {
		show('/?karte=heute&karte=ueberfaellig&karte=dringend');

		await fireEvent.click(card('Heute fällig: 2'));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/?karte=ueberfaellig&karte=dringend',
			NAVIGATION
		);
	});

	it('goes back to "Alle offenen" when the last card is taken out', async () => {
		show('/?karte=dringend&sort=titel');

		await fireEvent.click(card('Dringend: 1'));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/?sort=titel', NAVIGATION);
	});

	it('keeps the filters, the search, the view and the panel', async () => {
		show('/tickets/abc123def456ghi?status=open&projekt=ohne&q=Miete&sort=titel&gruppe=prio');

		await fireEvent.click(card('Überfällig: 4'));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/tickets/abc123def456ghi?karte=ueberfaellig&status=open&projekt=ohne&q=Miete&sort=titel' +
				'&gruppe=prio',
			NAVIGATION
		);
	});

	it('drops every card with "Alle offenen" and keeps the filters and the search', async () => {
		show('/?karte=in-arbeit&karte=heute&prio=high&q=Miete&gruppe=prio');

		await fireEvent.click(card('Alle offenen: 12'));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/?prio=high&q=Miete&gruppe=prio',
			NAVIGATION
		);
	});

	it('does not navigate when "Alle offenen" is already pressed', async () => {
		show('/?prio=high');

		await fireEvent.click(card('Alle offenen: 12'));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('keeps the focus on the card it toggles (keyboard)', async () => {
		show('/');
		const working = card('In Arbeit: 3');
		working.focus();

		await fireEvent.click(working);

		expect(document.activeElement).toBe(working);
		expect(mocks.goto).toHaveBeenCalledWith('/?karte=in-arbeit', NAVIGATION);
	});

	it('takes an old address over: its status, priority and due date stay filters of the bar', () => {
		// Before FI-1 a click on "Überfällig" and "Dringend" wrote these parameters.
		show('/?faellig=ueberfaellig&prio=urgent');

		expect(card('Alle offenen: 12').getAttribute('aria-pressed')).toBe('true');
		expect(card('Überfällig: 4').getAttribute('aria-pressed')).toBe('false');
		expect(card('Dringend: 1').getAttribute('aria-pressed')).toBe('false');
	});

	it('ignores unknown cards of an edited address', () => {
		show('/?karte=morgen&karte=dringend&karte=dringend');

		expect(card('Dringend: 1').getAttribute('aria-pressed')).toBe('true');
		expect(card('Alle offenen: 12').getAttribute('aria-pressed')).toBe('false');
	});

	it('uses no error colour, not even for "Überfällig" (ADR-0009)', () => {
		expect(source).not.toMatch(/danger/);
	});

	it('keeps a card at least 44 px high on touch screens (UI-1)', () => {
		expect(source).toMatch(
			/@media \(pointer: coarse\) \{\s*\.card \{\s*min-height: var\(--control-height-touch\);/
		);
	});
});
