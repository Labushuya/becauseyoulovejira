// Component tests for the summary above the list (FI-1, ADR-0013 addendum C): the chosen cards and
// the number of shown tickets, the note about further filters and "Zurücksetzen".

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FilterSummary from './FilterSummary.svelte';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('filter summary', () => {
	it('names the number and the chosen cards', () => {
		render(FilterSummary, {
			props: { cards: ['in_progress', 'due_today', 'urgent'], count: 12, onreset: vi.fn() }
		});

		expect(screen.getByText('12 Tickets aus: In Arbeit, Heute fällig, Dringend')).toBeTruthy();
	});

	it('says when filters narrow the cards and when more tickets match', () => {
		render(FilterSummary, {
			props: { cards: ['urgent'], count: 50, more: true, filtered: true, onreset: vi.fn() }
		});

		expect(
			screen.getByText('Mehr als 50 Tickets aus: Dringend – weitere Filter aktiv')
		).toBeTruthy();
	});

	it('resets with "Zurücksetzen"', async () => {
		const onreset = vi.fn();
		render(FilterSummary, { props: { cards: ['overdue'], count: 1, onreset } });

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.classList.contains('button-secondary')).toBe(true);
		await fireEvent.click(reset);
		expect(onreset).toHaveBeenCalledOnce();
	});
});
