// Component tests for the KPI tiles (E3 plan, T-10 and package 12): numbers, names from number
// and label, aria-pressed, the URL change per tile, toggling the pressed tile and "Nicht
// erledigt" as reset. SvelteKit navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kpis } from '$lib/domain/kpis';
import KpiTiles from './KpiTiles.svelte';
import source from './KpiTiles.svelte?raw';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const KPIS: Kpis = { notDone: 12, inProgress: 3, dueToday: 2, overdue: 4, urgent: 1 };

function show(path = '/', kpis: Kpis | null = KPIS) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	return render(KpiTiles, { props: { kpis } });
}

function tile(name: string) {
	return screen.getByRole('button', { name });
}

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('KPI tiles', () => {
	it('shows five tiles with number and label as their name', () => {
		show();

		const group = screen.getByRole('group', { name: 'Kennzahlen' });
		expect(
			within(group)
				.getAllByRole('button')
				.map((button) => button.textContent)
		).toHaveLength(5);
		for (const name of [
			'12 nicht erledigt',
			'3 in Arbeit',
			'2 heute fällig',
			'4 überfällig',
			'1 dringend'
		]) {
			expect(tile(name)).toBeTruthy();
		}
		expect(tile('4 überfällig').querySelector('.value')?.textContent).toBe('4');
	});

	it('shows no numbers while the list is not loaded', () => {
		show('/', null);

		expect(tile('Nicht erledigt').querySelector('.value')?.textContent).toBe('–');
		expect(tile('Überfällig')).toBeTruthy();
	});

	it('presses "Nicht erledigt" without filters and the tile whose group has its value', () => {
		show('/?faellig=ueberfaellig&sort=titel');

		expect(tile('12 nicht erledigt').getAttribute('aria-pressed')).toBe('false');
		expect(tile('4 überfällig').getAttribute('aria-pressed')).toBe('true');
		expect(tile('2 heute fällig').getAttribute('aria-pressed')).toBe('false');
		expect(tile('4 überfällig').querySelector('svg.check')).not.toBeNull();

		document.body.innerHTML = '';
		show('/?sort=titel&erledigte=1');
		expect(tile('12 nicht erledigt').getAttribute('aria-pressed')).toBe('true');
	});

	it.each([
		['3 in Arbeit', '/?prio=high', '/?status=in_progress&prio=high'],
		['2 heute fällig', '/?faellig=ueberfaellig', '/?faellig=heute'],
		['4 überfällig', '/?projekt=ohne', '/?faellig=ueberfaellig&projekt=ohne'],
		['1 dringend', '/?status=open', '/?status=open&prio=urgent']
	])('%s sets only its group (%s → %s)', async (name, from, to) => {
		show(from);

		await fireEvent.click(tile(name));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(to, { keepFocus: true, noScroll: true });
	});

	it('sets the group of a pressed tile back to "Alle"', async () => {
		show('/?status=in_progress&prio=high&sort=-erstellt');

		const inProgress = tile('3 in Arbeit');
		expect(inProgress.getAttribute('aria-pressed')).toBe('true');
		expect(
			document.getElementById(String(inProgress.getAttribute('aria-describedby')))?.textContent
		).toBe('Filter entfernen');
		await fireEvent.click(inProgress);

		expect(mocks.goto).toHaveBeenCalledWith('/?prio=high&sort=-erstellt', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('resets every filter and the search with "Nicht erledigt", but keeps the view', async () => {
		show('/tickets/abc123def456ghi?status=open&prio=urgent&q=Miete&sort=titel&gruppe=prio');

		await fireEvent.click(tile('12 nicht erledigt'));

		expect(mocks.goto).toHaveBeenCalledWith('/tickets/abc123def456ghi?sort=titel&gruppe=prio', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('does not navigate when "Nicht erledigt" is already pressed', async () => {
		show('/');

		await fireEvent.click(tile('12 nicht erledigt'));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('uses no error colour, not even for "Überfällig" (ADR-0009)', () => {
		expect(source).not.toMatch(/danger/);
	});
});
