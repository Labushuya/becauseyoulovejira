// Long lists of chips (ADR-0026, addendum KL): folding with "+ N weitere", the filter above 20
// entries with the normalisation of the ticket picker, Escape, the names for screen readers and
// the empty list.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChipList from './ChipList.svelte';

const LABEL = 'Stichwörter von „Gmail“';
const words = (count: number) => Array.from({ length: count }, (_, index) => `wort${index + 1}`);

function renderList(items: string[], emptyText: string | null = null) {
	return render(ChipList, { props: { items, label: LABEL, noun: 'Stichwörter', emptyText } });
}

/** Texts of the chips shown. */
function chips(): string[] {
	const list = screen.getByRole('list', { name: LABEL });
	return within(list)
		.queryAllByRole('listitem')
		.map((item) => item.textContent?.trim() ?? '');
}

describe('ChipList', () => {
	it('shows up to 10 entries whole, without button and filter', () => {
		renderList(words(10));
		expect(chips()).toEqual(words(10));
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.queryByRole('searchbox')).toBeNull();
	});

	it('folds a longer list to 8 with "+ N weitere" and unfolds it', async () => {
		renderList(words(12));
		expect(chips()).toEqual(words(8));
		const more = screen.getByRole('button', {
			name: `+ 4 weitere Stichwörter anzeigen: ${LABEL}`
		});
		expect(more.getAttribute('aria-expanded')).toBe('false');
		expect(more.getAttribute('aria-controls')).toBe(screen.getByRole('list', { name: LABEL }).id);

		await fireEvent.click(more);

		expect(chips()).toEqual(words(12));
		expect(more.getAttribute('aria-expanded')).toBe('true');
		expect(more.textContent?.trim()).toBe(`Weniger anzeigen: ${LABEL}`);
		expect(screen.getByRole('button', { name: `Weniger anzeigen: ${LABEL}` })).toBe(more);

		await fireEvent.click(more);
		expect(chips()).toEqual(words(8));
	});

	it('filters above 20 entries without case and umlaut dots and says how many it found', async () => {
		renderList([...words(21), 'Müller GmbH', 'Straße', 'Café Zentral']);
		const filter = screen.getByRole('searchbox', { name: 'Stichwörter filtern' });
		expect(
			filter.closest('.search-field')?.querySelector('svg[aria-hidden="true"]')
		).not.toBeNull();
		expect(chips()).toHaveLength(8);

		await fireEvent.input(filter, { target: { value: 'MULLER' } });

		expect(chips()).toEqual(['Müller GmbH']);
		expect(screen.queryByRole('button', { name: /weitere/ })).toBeNull();
		const count = screen.getByText('1 von 24');
		expect(filter.getAttribute('aria-describedby')).toBe(count.id);
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 von 24'), {
			timeout: 2000
		});

		await fireEvent.input(filter, { target: { value: 'wort1' } });
		expect(chips()).toHaveLength(11);
		await fireEvent.input(filter, { target: { value: 'xyz' } });
		expect(chips()).toEqual([]);
		expect(screen.getByText('Keine Treffer')).toBeTruthy();
	});

	it('empties the filter on Escape first and lets Escape through when it is empty', async () => {
		renderList(words(24));
		const filter = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Stichwörter filtern' });
		await fireEvent.input(filter, { target: { value: 'wort2' } });
		expect(chips()).toHaveLength(6);

		// fireEvent answers false when the event was cancelled (consumed).
		expect(await fireEvent.keyDown(filter, { key: 'Escape' })).toBe(false);
		expect(filter.value).toBe('');
		expect(chips()).toHaveLength(8);
		expect(await fireEvent.keyDown(filter, { key: 'Escape' })).toBe(true);
	});

	it('says "keine" without entries, or nothing', () => {
		const { unmount } = renderList([], 'keine');
		expect(screen.getByText('keine')).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();
		unmount();
		const { container } = renderList([]);
		expect(container.textContent?.trim()).toBe('');
	});
});
