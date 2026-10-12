// A list in pages of five (TD-1, ADR-0031 addendum L): no controls up to five entries, "‹ Zurück",
// "Seite x von y · N Quellen" and "Weiter ›" above that, named buttons that are aria-disabled at the
// ends, the focus on the first entry of the new page, the polite announcement, the page before when
// a page became empty, page 1 for another ticket and the page of a held entry.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PagedList from './PagedList.svelte';

interface Entry {
	id: string;
	name: string;
}

const LABEL = 'Quellen aus dem Eingang';
const NOUN = { one: 'Quelle', other: 'Quellen' };
const PREVIOUS = 'Zurück zur vorherigen Seite der Quellen';
const NEXT = 'Weiter zur nächsten Seite der Quellen';

const entries = (count: number, from = 1): Entry[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `entry${index + from}`,
		name: `Eintrag ${index + from}`
	}));

/** An entry with a button inside, so a test can lose the focus with the entry. */
const row = createRawSnippet((entry: () => Entry) => ({
	render: () =>
		`<div><span>${entry().name}</span> <button type="button">${entry().name} lösen</button></div>`
}));

function show(items: Entry[], extra: { hold?: string | null; resetKey?: string } = {}) {
	const onpagechange = vi.fn();
	const view = render(PagedList<Entry>, {
		props: {
			items,
			key: (entry: Entry) => entry.id,
			label: LABEL,
			noun: NOUN,
			resetKey: extra.resetKey ?? 'ticket1',
			hold: extra.hold ?? null,
			onpagechange,
			row
		}
	});
	return { ...view, onpagechange };
}

/** Names of the entries shown on the page. */
function shown(): string[] {
	const list = screen.getByRole('list', { name: LABEL });
	return within(list)
		.queryAllByRole('listitem')
		.map((item) => item.querySelector('span')?.textContent ?? '');
}

const status = () => screen.getByRole('status').textContent?.trim() ?? '';
const position = () =>
	(document.querySelector('.position')?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('PagedList (TD-1)', () => {
	it('shows no controls for an empty list and for five entries', async () => {
		const { rerender } = show([]);
		expect(shown()).toEqual([]);
		expect(screen.queryByRole('button', { name: NEXT })).toBeNull();
		expect(screen.queryByRole('group', { name: 'Seiten der Quellen' })).toBeNull();

		await rerender({ items: entries(5) });
		expect(shown()).toEqual(entries(5).map((entry) => entry.name));
		expect(screen.queryByRole('button', { name: NEXT })).toBeNull();
		expect(status()).toBe('');
	});

	it('splits six entries into two pages with named controls below the list', async () => {
		show(entries(6));
		expect(shown()).toEqual(entries(5).map((entry) => entry.name));
		const group = screen.getByRole('group', { name: 'Seiten der Quellen' });
		const previous = within(group).getByRole('button', { name: PREVIOUS });
		const next = within(group).getByRole('button', { name: NEXT });
		// The visible words start the names (WCAG 2.5.3); the arrows are hidden.
		expect(previous.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'‹ Zurück zur vorherigen Seite der Quellen'
		);
		expect(previous.getAttribute('aria-disabled')).toBe('true');
		expect(next.getAttribute('aria-disabled')).toBeNull();
		expect(position()).toBe('Seite 1 von 2 · 6 Quellen');
		// The controls stand after the list.
		const list = screen.getByRole('list', { name: LABEL });
		expect(list.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.click(next);
		expect(shown()).toEqual(['Eintrag 6']);
		expect(position()).toBe('Seite 2 von 2 · 6 Quellen');
		expect(next.getAttribute('aria-disabled')).toBe('true');
		expect(previous.getAttribute('aria-disabled')).toBeNull();
	});

	it('pages through twelve entries: focus on the start of the new page, the page said politely', async () => {
		const { onpagechange } = show(entries(12));
		expect(position()).toBe('Seite 1 von 3 · 12 Quellen');
		const next = screen.getByRole('button', { name: NEXT });
		const previous = screen.getByRole('button', { name: PREVIOUS });

		next.focus();
		await fireEvent.click(next);
		await tick();
		expect(shown()).toEqual(['Eintrag 6', 'Eintrag 7', 'Eintrag 8', 'Eintrag 9', 'Eintrag 10']);
		expect(document.activeElement?.tagName).toBe('LI');
		expect(document.activeElement?.textContent).toContain('Eintrag 6');
		expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
		expect(status()).toBe('Seite 2 von 3');
		expect(onpagechange).toHaveBeenLastCalledWith(1);

		await fireEvent.click(next);
		await tick();
		expect(shown()).toEqual(['Eintrag 11', 'Eintrag 12']);
		expect(status()).toBe('Seite 3 von 3');
		expect(next.getAttribute('aria-disabled')).toBe('true');
		// At the end the button stays focusable and does nothing.
		next.focus();
		await fireEvent.click(next);
		expect(shown()).toEqual(['Eintrag 11', 'Eintrag 12']);
		expect(document.activeElement).toBe(next);
		expect(onpagechange).toHaveBeenCalledTimes(2);

		await fireEvent.click(previous);
		await tick();
		expect(shown()[0]).toBe('Eintrag 6');
		expect(document.activeElement?.textContent).toContain('Eintrag 6');
		expect(status()).toBe('Seite 2 von 3');
		expect(onpagechange).toHaveBeenLastCalledWith(1);
	});

	it('shows the page before when its page became empty, says so and gives a lost focus its start', async () => {
		const { rerender } = show(entries(11));
		await fireEvent.click(screen.getByRole('button', { name: NEXT }));
		await fireEvent.click(screen.getByRole('button', { name: NEXT }));
		expect(shown()).toEqual(['Eintrag 11']);
		// The focus is on the button of the only entry of the page, which then leaves the list.
		screen.getByRole('button', { name: 'Eintrag 11 lösen' }).focus();

		await rerender({ items: entries(10) });
		await vi.waitFor(() => expect(status()).toBe('Seite 2 von 2'));
		expect(shown()[0]).toBe('Eintrag 6');
		expect(position()).toBe('Seite 2 von 2 · 10 Quellen');
		await vi.waitFor(() => expect(document.activeElement?.textContent).toContain('Eintrag 6'));

		// The page stays when the list grows again; it does not jump back.
		await rerender({ items: entries(12) });
		expect(position()).toBe('Seite 2 von 3 · 12 Quellen');
	});

	it('leaves a focus that was not lost where it is', async () => {
		const { rerender } = show(entries(11));
		const next = screen.getByRole('button', { name: NEXT });
		await fireEvent.click(next);
		await fireEvent.click(next);
		const previous = screen.getByRole('button', { name: PREVIOUS });
		previous.focus();

		await rerender({ items: entries(10) });
		await vi.waitFor(() => expect(status()).toBe('Seite 2 von 2'));
		await tick();
		expect(document.activeElement).toBe(previous);
	});

	it('drops the controls with the sixth entry and gives a focus lost with them the first entry', async () => {
		const { rerender } = show(entries(6));
		await fireEvent.click(screen.getByRole('button', { name: NEXT }));
		screen.getByRole('button', { name: PREVIOUS }).focus();

		await rerender({ items: entries(5) });
		await vi.waitFor(() => expect(shown()).toHaveLength(5));
		expect(screen.queryByRole('group', { name: 'Seiten der Quellen' })).toBeNull();
		await vi.waitFor(() => expect(document.activeElement?.textContent).toContain('Eintrag 1'));
		// One page has no number to say.
		expect(status()).toBe('');
	});

	it('starts on page 1 for another ticket, without saying anything', async () => {
		const { rerender } = show(entries(12));
		await fireEvent.click(screen.getByRole('button', { name: NEXT }));
		expect(status()).toBe('Seite 2 von 3');

		await rerender({ resetKey: 'ticket2', items: entries(12, 21) });
		expect(shown()[0]).toBe('Eintrag 21');
		expect(position()).toBe('Seite 1 von 3 · 12 Quellen');
		expect(status()).toBe('');
	});

	it('keeps the page of a held entry while the list changes around it, quietly', async () => {
		const { rerender } = show(entries(12));
		await fireEvent.click(screen.getByRole('button', { name: NEXT }));
		expect(shown()).toContain('Eintrag 7');
		await rerender({ hold: 'entry7' });

		// Four new entries before it push it to the third page: the list follows it.
		await rerender({ items: [...entries(4, 101), ...entries(12)] });
		expect(shown()).toContain('Eintrag 7');
		expect(position()).toBe('Seite 3 von 4 · 16 Quellen');
		expect(status()).toBe('Seite 2 von 3');

		// Let go: the page stays where the entry was.
		await rerender({ hold: null });
		expect(position()).toBe('Seite 3 von 4 · 16 Quellen');
		expect(shown()).toContain('Eintrag 7');
	});
});
