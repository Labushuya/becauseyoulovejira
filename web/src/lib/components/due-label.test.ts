// Component tests for the due label (E3 plan, T-9 and package 6) with a fixed "today": every kind
// of label, datetime, title and the text for screen readers, done tickets with the plain date,
// icons without red, and the change of "today" without a reload.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DueLabel from './DueLabel.svelte';
import source from './DueLabel.svelte?raw';

const TODAY = '2026-09-25';

function show(due: string | null, done = false, today = TODAY) {
	const result = render(DueLabel, { props: { due, today, done } });
	const root = result.container.querySelector<HTMLElement>('.due')!;
	const time = root.querySelector('time');
	return { ...result, root, time };
}

/** Visible text: the text nodes outside the parts only for screen readers. */
function visibleText(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	for (const hidden of clone.querySelectorAll('.visually-hidden')) hidden.remove();
	return clone.textContent?.trim() ?? '';
}

describe('due label', () => {
	// WH-1: an overdue ticket names the day it is overdue since; screen readers hear the year too.
	it.each([
		['2026-08-26', 'überfällig seit 26.08.'],
		['2026-09-23', 'überfällig seit 23.09.'],
		['2026-09-24', 'überfällig seit 24.09.']
	])('shows %s as "%s", with the year for screen readers', (due, text) => {
		const { root, time } = show(due);
		const [year, month, day] = due.split('-');
		const date = `${day}.${month}.${year}`;

		expect(root.dataset.due).toBe('overdue');
		expect(visibleText(root)).toBe(text);
		expect(time?.getAttribute('datetime')).toBe(due);
		expect(time?.getAttribute('title')).toBe(date);
		expect(time?.querySelector('.visually-hidden')?.textContent).toBe(year);
		expect(time?.textContent).toBe(`überfällig seit ${date}`);
	});

	it('names the year of an overdue date of another year in the visible text', () => {
		const { time } = show('2025-12-30', false, '2026-01-02');

		expect(time?.textContent).toBe('überfällig seit 30.12.2025');
		expect(time?.querySelector('.visually-hidden')).toBeNull();
	});

	it.each([
		['2026-09-25', 'heute', 'today'],
		['2026-09-26', 'morgen', 'tomorrow'],
		['2026-09-27', 'in 2 Tagen', 'soon'],
		['2026-10-02', 'in 7 Tagen', 'soon']
	])('shows %s as "%s" with the full date for screen readers', (due, text, kind) => {
		const { root, time } = show(due);
		const [year, month, day] = due.split('-');
		const date = `${day}.${month}.${year}`;

		expect(root.dataset.due).toBe(kind);
		expect(visibleText(root)).toBe(text);
		expect(time?.getAttribute('datetime')).toBe(due);
		expect(time?.getAttribute('title')).toBe(date);
		expect(time?.querySelector('.visually-hidden')?.textContent).toBe(`, ${date}`);
		expect(time?.textContent).toBe(`${text}, ${date}`);
	});

	it('shows the plain date from day 8 on, without an extra text', () => {
		const { root, time } = show('2026-10-03');

		expect(root.dataset.due).toBe('later');
		expect(time?.textContent).toBe('03.10.2026');
		expect(time?.getAttribute('title')).toBe('03.10.2026');
		expect(time?.querySelector('.visually-hidden')).toBeNull();
	});

	it('crosses the turn of the year', () => {
		const { time } = show('2027-01-02', false, '2026-12-30');

		expect(time?.textContent).toBe('in 3 Tagen, 02.01.2027');
	});

	it('shows a dash with a text alternative without a due date', () => {
		const { root, time } = show(null);

		expect(time).toBeNull();
		expect(root.dataset.due).toBe('none');
		expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe('–');
		expect(root.querySelector('.visually-hidden')?.textContent).toBe('keine Fälligkeit');
	});

	it('shows only the date for done tickets, also when it lies in the past', () => {
		const { root, time } = show('2026-09-20', true);

		expect(root.dataset.due).toBe('plain');
		expect(time?.textContent).toBe('20.09.2026');
		expect(time?.getAttribute('datetime')).toBe('2026-09-20');
		expect(root.querySelector('svg')).toBeNull();
	});

	it('marks overdue with an icon and text, today and tomorrow with an icon, others without', () => {
		expect(show('2026-09-20').root.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(show('2026-09-25').root.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(show('2026-09-26').root.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(show('2026-09-28').root.querySelector('svg')).toBeNull();
	});

	it('uses no error colour (ADR-0009)', () => {
		expect(source).not.toMatch(/danger/);
	});

	it('changes the label when "today" changes, without a reload', async () => {
		const { rerender, container } = show('2026-09-26');
		expect(visibleText(container.querySelector('.due')!)).toBe('morgen');

		await rerender({ due: '2026-09-26', today: '2026-09-26', done: false });

		expect(visibleText(container.querySelector('.due')!)).toBe('heute');
	});
});
