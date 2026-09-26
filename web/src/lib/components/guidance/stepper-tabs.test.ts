// Component tests of the stepper and the tabs of the assistant (plan EH-5 §3.11): the stepper is a
// named navigation with an ordered list, each step a button with its state in the name, the current
// one with aria-current="step", and no step locked; the compact menu offers the same steps. The
// tabs follow the APG pattern with manual activation: arrows, Home and End move the focus with a
// roving tabindex, Enter, Space or a click select; each tab controls its named panel.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { tabTarget } from '$lib/guidance/tabs';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import Stepper from './Stepper.svelte';
import Tabs from './Tabs.svelte';

useOverlayStubs();

const STEPS = [
	{ id: 'connect', label: 'Verbinden', state: 'done' as const },
	{ id: 'address', label: 'Adresse holen', state: 'warning' as const },
	{ id: 'variable', label: 'Variable setzen', state: 'current' as const },
	{ id: 'restart', label: 'Neu starten', state: 'open' as const }
];

describe('stepper', () => {
	it('is a named navigation with an ordered list and the state in every name', () => {
		render(Stepper, { props: { steps: STEPS, current: 2, onselect: vi.fn() } });

		const nav = screen.getByRole('navigation', { name: 'Schritte der Einrichtung' });
		const list = within(nav).getByRole('list');
		expect(list.tagName).toBe('OL');
		const buttons = within(list).getAllByRole('button');
		const names = [
			'Schritt 1 von 4: Verbinden, erledigt',
			'Schritt 2 von 4: Adresse holen, Prüfung offen',
			'Schritt 3 von 4: Variable setzen, aktuell',
			'Schritt 4 von 4: Neu starten, offen'
		];
		expect(buttons).toEqual(names.map((name) => within(list).getByRole('button', { name })));
		expect(buttons[1]?.textContent).toMatch(/Prüfung offen/);
		const current = within(list).getByRole('button', { name: /Variable setzen, aktuell/ });
		expect(current.getAttribute('aria-current')).toBe('step');
		expect(
			within(list)
				.getAllByRole('button')
				.filter((button) => button.hasAttribute('aria-current'))
		).toHaveLength(1);
		expect(nav.querySelector('.bar')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('lets every step be chosen, also an open one', async () => {
		const onselect = vi.fn();
		render(Stepper, { props: { steps: STEPS, current: 2, onselect } });

		await fireEvent.click(screen.getByRole('button', { name: /Neu starten, offen/ }));
		await fireEvent.click(screen.getByRole('button', { name: /Verbinden, erledigt/ }));
		expect(onselect.mock.calls).toEqual([[3], [0]]);
	});

	it('offers the steps in the compact menu "Alle Schritte"', async () => {
		const onselect = vi.fn();
		render(Stepper, { props: { steps: STEPS, current: 2, onselect } });

		expect(screen.getByText('Schritt 3 von 4 · Variable setzen')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Alle Schritte' }));
		const items = screen.getAllByRole('menuitemradio', { hidden: true });
		expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'true',
			'false'
		]);
		await fireEvent.click(items[1] as HTMLElement);
		expect(onselect).toHaveBeenCalledWith(1);
	});
});

describe('tabs', () => {
	const TABS = [
		{ id: 'eingabeaufforderung', label: 'Eingabeaufforderung' },
		{ id: 'systemsteuerung', label: 'Systemsteuerung' }
	];
	const panel = createRawSnippet((id: () => string) => ({
		render: () => `<p>Inhalt ${id()}</p>`
	}));

	function show(selected = 'eingabeaufforderung') {
		const onselect = vi.fn();
		const view = render(Tabs, {
			props: { label: 'Weg zur Variablen', tabs: TABS, selected, onselect, panel }
		});
		return { onselect, view };
	}

	it('moves in a circle, to the ends and not beyond', () => {
		expect(tabTarget('ArrowRight', 0, 2)).toBe(1);
		expect(tabTarget('ArrowRight', 1, 2)).toBe(0);
		expect(tabTarget('ArrowLeft', 0, 2)).toBe(1);
		expect(tabTarget('Home', 1, 3)).toBe(0);
		expect(tabTarget('End', 0, 3)).toBe(2);
		expect(tabTarget('Enter', 0, 2)).toBeNull();
		expect(tabTarget('ArrowRight', 0, 0)).toBeNull();
	});

	it('has a named tab list whose tabs control named panels', () => {
		show();

		const list = screen.getByRole('tablist', { name: 'Weg zur Variablen' });
		const [first, second] = within(list).getAllByRole('tab');
		expect(first?.getAttribute('aria-selected')).toBe('true');
		expect(second?.getAttribute('aria-selected')).toBe('false');
		expect(first?.getAttribute('tabindex')).toBe('0');
		expect(second?.getAttribute('tabindex')).toBe('-1');
		const shown = screen.getByRole('tabpanel', { name: 'Eingabeaufforderung' });
		expect(first?.getAttribute('aria-controls')).toBe(shown.id);
		expect(shown.getAttribute('tabindex')).toBe('0');
		expect(shown.textContent).toBe('Inhalt eingabeaufforderung');
		expect(screen.queryByText('Inhalt systemsteuerung')).toBeNull();
	});

	it('moves the focus with the arrows but selects only with Enter or a click (manual)', async () => {
		const { onselect, view } = show();
		const [first, second] = screen.getAllByRole('tab');
		first?.focus();

		await fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(second);
		expect(second?.getAttribute('tabindex')).toBe('0');
		expect(first?.getAttribute('tabindex')).toBe('-1');
		expect(onselect).not.toHaveBeenCalled();

		await fireEvent.keyDown(second as HTMLElement, { key: 'Home' });
		expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(first as HTMLElement, { key: 'End' });
		expect(document.activeElement).toBe(second);

		await fireEvent.click(second as HTMLElement);
		expect(onselect).toHaveBeenCalledWith('systemsteuerung');
		await view.rerender({ selected: 'systemsteuerung' });
		expect(screen.getByRole('tabpanel', { name: 'Systemsteuerung' }).textContent).toBe(
			'Inhalt systemsteuerung'
		);
	});
});
