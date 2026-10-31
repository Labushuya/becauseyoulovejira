// The focus after an action of the bar of the selection (MO-7c1, Q-1 and Q-2 of the review of MO-7b;
// NA-1, C4 of the review of MO-7c1): it stays where it is while it is in the bar; lost with the
// action (on the page, body) it goes into the bar while the bar stands, otherwise to the heading. An
// element the user chose meanwhile, during a long run, keeps it.

import { afterEach, describe, expect, it } from 'vitest';
import { keepFocusAtBar } from './selection-focus';

/** A bar with two buttons, a heading that takes the focus and a field outside of both. */
function place() {
	document.body.innerHTML = `
		<h2 tabindex="-1">Aufgaben</h2>
		<input aria-label="Suche" />
		<section class="bar"><button type="button">Aktionen</button><button type="button">Fertig</button></section>`;
	const heading = document.querySelector<HTMLElement>('h2')!;
	const field = document.querySelector<HTMLElement>('input')!;
	const bar = document.querySelector<HTMLElement>('section')!;
	const [first, second] = [...bar.querySelectorAll<HTMLElement>('button')];
	return { heading, field, bar, first: first!, second: second! };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the focus after an action of the bar of the selection (MO-7c1, NA-1)', () => {
	it('leaves the focus where it is while it is in the bar', () => {
		const { heading, bar, second } = place();
		second.focus();
		keepFocusAtBar(bar, heading);
		expect(document.activeElement).toBe(second);
	});

	it('puts a focus lost with the action on the first button of the bar while the bar stands', () => {
		const { heading, bar, first } = place();
		expect(document.activeElement).toBe(document.body);
		keepFocusAtBar(bar, heading);
		expect(document.activeElement).toBe(first);
	});

	it('puts a focus lost with the action on the heading once the bar is gone', () => {
		const { heading, bar } = place();
		bar.remove();
		keepFocusAtBar(bar, heading);
		expect(document.activeElement).toBe(heading);
		heading.blur();
		expect(document.activeElement).toBe(document.body);
		keepFocusAtBar(undefined, heading);
		expect(document.activeElement).toBe(heading);
	});

	// NA-1 (C4): before, the bar took the focus back from an element the user chose during the run.
	it('leaves an element the user chose meanwhile alone, whether the bar stands or not (NA-1, C4)', () => {
		const { heading, field, bar } = place();
		field.focus();
		keepFocusAtBar(bar, heading);
		expect(document.activeElement).toBe(field);
		bar.remove();
		keepFocusAtBar(bar, heading);
		expect(document.activeElement).toBe(field);
	});
});
