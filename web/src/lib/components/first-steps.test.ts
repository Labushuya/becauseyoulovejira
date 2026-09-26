// "Erste Schritte" (plan EH-12): the list with progress, a way to every open step, the quick entry
// through the context of the layout, the tour only where it can start, dismissing with the focus on
// the heading of the view, and the state in localStorage (also when the storage refuses).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_STEPS_STORAGE_KEY } from '$lib/domain/first-steps';
import { QUICK_CAPTURE_CONTEXT } from '$lib/quick-capture-context';
import { FirstStepsStore, localStore } from '$lib/stores/first-steps.svelte';
import FirstSteps from './FirstSteps.svelte';

afterEach(() => {
	localStorage.clear();
	document.body.innerHTML = '';
});

function show(options: { reached?: string[]; onstarttour?: () => void; quick?: () => void } = {}) {
	if (options.reached) {
		localStorage.setItem(
			FIRST_STEPS_STORAGE_KEY,
			JSON.stringify({ dismissed: false, reached: options.reached })
		);
	}
	const store = new FirstStepsStore(localStore);
	const context = options.quick ? new Map([[QUICK_CAPTURE_CONTEXT, options.quick]]) : undefined;
	render(FirstSteps, { props: { store, onstarttour: options.onstarttour }, context });
	return store;
}

function section() {
	return within(screen.getByRole('region', { name: 'Erste Schritte' }));
}

describe('first steps (EH-12)', () => {
	it('shows four steps with progress while the tour is not offered', () => {
		show({ reached: ['ticket'] });

		const items = section().getAllByRole('listitem');
		expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Erstes Ticket anlegen, erledigt',
			'Schnellerfassung ausprobieren, offen',
			'Einen Kanal einrichten, offen Kanäle öffnen',
			'Ein Projekt anlegen, offen Projekt anlegen'
		]);
		expect(section().getByText('1 von 4 erledigt')).toBeTruthy();
		const bar = screen.getByRole('progressbar');
		expect(bar.getAttribute('max')).toBe('4');
		expect(bar.getAttribute('value')).toBe('1');
		expect(section().getByRole('link', { name: 'Kanäle öffnen' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele'
		);
		expect(section().getByRole('link', { name: 'Projekt anlegen' }).getAttribute('href')).toBe(
			'/projekte/neu'
		);
		expect(section().queryByRole('link', { name: 'Ticket anlegen' })).toBeNull();
		expect(section().queryByText(/Kurze Einführung/)).toBeNull();
	});

	it('opens the quick entry of the layout and offers the tour where it can start', async () => {
		const quick = vi.fn();
		const onstarttour = vi.fn();
		show({ quick, onstarttour });

		expect(section().getByText('0 von 5 erledigt')).toBeTruthy();
		await fireEvent.click(section().getByRole('button', { name: /Öffnen/ }));
		expect(quick).toHaveBeenCalledOnce();
		await fireEvent.click(section().getByRole('button', { name: 'Starten' }));
		expect(onstarttour).toHaveBeenCalledOnce();
	});

	it('follows the store and disappears when every offered step is done', async () => {
		const store = show({ reached: ['ticket', 'quick', 'channel'] });
		expect(section().getByText('3 von 4 erledigt')).toBeTruthy();

		store.reach('project');
		await tick();

		expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
		expect(JSON.parse(localStorage.getItem(FIRST_STEPS_STORAGE_KEY) ?? '{}').reached).toEqual([
			'ticket',
			'quick',
			'channel',
			'project'
		]);
	});

	it('hides for good on "ausblenden" and moves the focus to the heading of the view', async () => {
		const heading = document.createElement('h2');
		heading.tabIndex = -1;
		heading.dataset.viewHeading = '';
		document.body.append(heading);
		show();

		const close = section().getByRole('button', { name: 'Erste Schritte ausblenden' });
		expect(close.getAttribute('title')).toBe('Erste Schritte ausblenden');
		await fireEvent.click(close);
		await tick();

		expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
		expect(document.activeElement).toBe(heading);
		expect(JSON.parse(localStorage.getItem(FIRST_STEPS_STORAGE_KEY) ?? '{}').dismissed).toBe(true);
		// A new page load keeps it hidden.
		document.body.innerHTML = '';
		show();
		expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
	});

	it('works for this page when the storage refuses', async () => {
		const store = new FirstStepsStore(() => ({
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			}
		}));
		expect(store.state.reached).toEqual([]);
		store.reach('quick');
		store.dismiss();
		expect(store.state).toEqual({ dismissed: true, reached: ['quick'] });
		expect(new FirstStepsStore(() => null).state.dismissed).toBe(false);
	});
});
