// The bar of the selection in the phone frame (MO-7b, ADR-0073 addendum MO-7b): one bar for
// "Aufgaben", "Eingang" and "Papierkorb", at the bottom above the bottom bar instead of at the top. It
// is flat, one row of 44 px: the number of the chosen rows, "Aktionen" and "Fertig". "Aktionen" opens
// the same buttons as on the PC above the row; while nothing is chosen it is locked and says why
// instead of going away. The counter-checks: on a PC with the switch on and on a phone with the switch
// off the bar stays as it was (all actions, × "Auswahl aufheben"). The place itself (above the bottom
// bar and the keyboard) is checked statically here and in a browser by
// tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import SelectionBar from './SelectionBar.svelte';

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
	document.body.innerHTML = '';
});

const actions = createRawSnippet(() => ({
	render: () =>
		'<span class="test-actions"><button type="button">Wiederherstellen</button><button type="button">Endgültig löschen …</button></span>'
}));

function show(props: Record<string, unknown> = {}) {
	const onclear = vi.fn();
	render(SelectionBar, {
		props: {
			countText: '2 Tickets ausgewählt',
			onclear,
			actions,
			hint: 'Erst Tickets auswählen.',
			...props
		}
	});
	return { onclear, bar: screen.getByRole('region', { name: /ausgewählt$/ }) };
}

describe('the bar of the selection in the phone frame (MO-7b)', () => {
	it('is one flat row: the number, "Aktionen" and "Fertig"; the actions one level deeper', async () => {
		useWindow(true, true);
		const { bar, onclear } = show();

		expect(bar.hasAttribute('data-selection-bar')).toBe(true);
		const row = bar.querySelector('.phone-row') as HTMLElement;
		expect(row.textContent).toMatch(/2 Tickets ausgewählt/);
		expect(
			within(row)
				.getAllByRole('button')
				.map((button) => button.textContent?.trim())
		).toEqual(['Aktionen', 'Fertig']);
		expect(within(bar).queryByRole('button', { name: 'Wiederherstellen' })).toBeNull();
		expect(within(bar).queryByRole('button', { name: 'Auswahl aufheben' })).toBeNull();

		const open = within(bar).getByRole('button', { name: 'Aktionen' });
		expect(open.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(open);
		await tick();
		expect(open.getAttribute('aria-expanded')).toBe('true');
		const group = within(bar).getByRole('group', { name: 'Sammelaktionen' });
		expect(open.getAttribute('aria-controls')).toBe(group.id);
		expect(within(group).getByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
		// The actions stand above the row, in the reading order before it.
		expect(group.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.click(open);
		await tick();
		expect(within(bar).queryByRole('group', { name: 'Sammelaktionen' })).toBeNull();

		await fireEvent.click(within(bar).getByRole('button', { name: 'Fertig' }));
		expect(onclear).toHaveBeenCalledOnce();
	});

	it('locks "Aktionen" while nothing is chosen and says why, instead of going away', async () => {
		useWindow(true, true);
		const { bar } = show({ countText: '0 Tickets ausgewählt', actionsShown: false });

		const open = within(bar).getByRole('button', { name: 'Aktionen' });
		expect(open.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(open.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Erst Tickets auswählen.'
		);
		await fireEvent.click(open);
		await tick();
		expect(open.getAttribute('aria-expanded')).toBe('false');
		expect(within(bar).queryByRole('group', { name: 'Sammelaktionen' })).toBeNull();
		expect(within(bar).getByRole('button', { name: 'Fertig' })).toBeTruthy();
	});

	it('shows the progress of a running action instead of the buttons', () => {
		useWindow(true, true);
		const { bar } = show({ progress: { total: 3, done: 1, text: 'Wiederherstellen: 1 von 3' } });
		expect(within(bar).getByRole('status').textContent).toMatch(/Wiederherstellen: 1 von 3/);
		expect(within(bar).queryByRole('button', { name: 'Aktionen' })).toBeNull();
		expect(bar.getAttribute('aria-busy')).toBe('true');
	});
});

describe('the bar of the selection outside the phone frame stays as it was (MO-7b)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('shows every action and × "Auswahl aufheben" on %s', async (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		const { bar, onclear } = show();
		expect(bar.hasAttribute('data-selection-bar')).toBe(false);
		expect(within(bar).getByRole('group', { name: 'Sammelaktionen' })).toBeTruthy();
		expect(within(bar).getByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
		expect(within(bar).queryByRole('button', { name: 'Aktionen' })).toBeNull();
		expect(within(bar).queryByRole('button', { name: 'Fertig' })).toBeNull();
		await fireEvent.click(within(bar).getByRole('button', { name: 'Auswahl aufheben' }));
		expect(onclear).toHaveBeenCalledOnce();
	});
});

describe('styles of the bar of the selection in the phone frame (MO-7b)', () => {
	const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

	it('stands fixed at the bottom above the bottom bar, also above a keyboard, without jumping', () => {
		const source = read('SelectionBar.svelte');
		const frame = source.slice(source.indexOf('@media (max-width: 39.99rem) {'));
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.bulk-bar \{\s*position: fixed;\s*top: auto;[^}]*bottom: calc\(var\(--bottom-bar-height\) \+ var\(--safe-bottom\) \+ 0\.5rem\);/
		);
		// After the cards it keeps the room of its row, so the last card scrolls above it.
		expect(frame).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.selection-room \{\s*height: calc\(var\(--control-height-touch\) \+ 2\.5rem\);/
		);
		// It keeps its place while the bottom bar gives way to the keyboard: a tap on "Fertig" closes
		// the keyboard, and the bar must not move below the finger meanwhile.
		expect(frame).not.toMatch(/\[data-phone-frame='bottom-bar'\]\[hidden\]/);
	});

	it('puts the flags at the top while the bar of the selection stands at the bottom', () => {
		const source = read('overlay/FlagGroup.svelte');
		expect(source).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]:has\(\[data-selection-bar\]\)\) \.flags \{\s*top: calc\(0\.5rem \+ var\(--safe-top\)\);\s*bottom: auto;/
		);
	});
});
