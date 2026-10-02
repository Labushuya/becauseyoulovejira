// Markdown.svelte with tasks (ADR-0032 section 6, RT-2): without `ontoggletask` the checkboxes stay
// disabled; with it they can be ticked, are locked and busy while a change is saved, go back when
// saving fails, and are locked with a reason while `taskHint` is set. Links to tickets open where
// the text stands (ADR-0054 §7): a plain click goes through the host, a modifier, another button or
// another link stays with the browser.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TicketHostHarness from '$lib/test/TicketHostHarness.svelte';
import { INBOX_HOST } from '$lib/ticket-host';
import Markdown from './Markdown.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/eingang/item00000000001?quelle=mail') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SOURCE = '- [ ] Milch\n- [x] Brot\n\n1. [ ] nummeriert';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function box(name: string): HTMLInputElement {
	return screen.getByRole('checkbox', { name });
}

describe('Markdown: tasks', () => {
	it('keeps the checkboxes disabled without a handler', () => {
		render(Markdown, { source: SOURCE });

		expect(screen.getAllByRole('checkbox')).toHaveLength(2);
		expect(box('Milch').disabled).toBe(true);
		expect(box('Brot').checked).toBe(true);
	});

	it('lets tasks be ticked and passes index and state', async () => {
		const ontoggletask = vi.fn(async () => true);
		render(Markdown, { source: SOURCE, ontoggletask });
		await tick();

		expect(box('Milch').disabled).toBe(false);
		await fireEvent.click(box('Milch'));
		await fireEvent.click(box('Brot'));

		expect(ontoggletask).toHaveBeenNthCalledWith(1, 0, true);
		expect(ontoggletask).toHaveBeenNthCalledWith(2, 1, false);
	});

	it('locks every box and marks the ticked one busy while saving', async () => {
		const saving = deferred<boolean>();
		const ontoggletask = vi.fn(() => saving.promise);
		render(Markdown, { source: SOURCE, ontoggletask });
		await tick();

		await fireEvent.click(box('Milch'));
		await tick();

		expect(box('Milch').getAttribute('aria-busy')).toBe('true');
		expect(box('Milch').getAttribute('aria-disabled')).toBe('true');
		expect(box('Brot').getAttribute('aria-disabled')).toBe('true');
		expect(box('Brot').hasAttribute('aria-busy')).toBe(false);
		await fireEvent.click(box('Brot'));
		expect(box('Brot').checked).toBe(true);
		expect(ontoggletask).toHaveBeenCalledOnce();

		saving.resolve(true);
		await vi.waitFor(() => expect(box('Milch').hasAttribute('aria-busy')).toBe(false));
		expect(box('Brot').hasAttribute('aria-disabled')).toBe(false);
	});

	it('puts the box back when saving fails', async () => {
		const ontoggletask = vi.fn(async () => false);
		render(Markdown, { source: SOURCE, ontoggletask });
		await tick();

		await fireEvent.click(box('Milch'));

		await vi.waitFor(() => expect(ontoggletask).toHaveBeenCalled());
		await vi.waitFor(() => expect(box('Milch').checked).toBe(false));
	});

	it('locks the tasks with a reason while a hint is set', async () => {
		const ontoggletask = vi.fn(async () => true);
		render(Markdown, {
			source: SOURCE,
			ontoggletask,
			taskHint: 'Die Beschreibung wird gerade gespeichert.'
		});
		await tick();

		expect(box('Milch').getAttribute('aria-disabled')).toBe('true');
		const hint = document.getElementById(box('Milch').getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe('Die Beschreibung wird gerade gespeichert.');
		await fireEvent.click(box('Milch'));
		expect(box('Milch').checked).toBe(false);
		expect(ontoggletask).not.toHaveBeenCalled();
	});

	it('enables the boxes of a new text after it renders', async () => {
		const ontoggletask = vi.fn(async () => true);
		const view = render(Markdown, { source: '- [ ] eins', ontoggletask });
		await tick();

		await view.rerender({ source: '- [x] eins\n- [ ] zwei', ontoggletask });
		await tick();

		expect(box('eins').checked).toBe(true);
		expect(box('zwei').disabled).toBe(false);
	});
});

describe('Markdown: links to tickets (ADR-0054 §7)', () => {
	const TICKET = 'abc123def456ghi';
	const LINKS = `Siehe [HAUS-1](/tickets/${TICKET}) und [Seite](https://example.com/).`;
	/** Whether each click reached the document taken (default prevented) by the text. */
	let taken: boolean[] = [];
	// After the handler of the text: records the click and keeps jsdom from navigating.
	const record = (event: MouseEvent) => {
		taken.push(event.defaultPrevented);
		event.preventDefault();
	};

	beforeEach(() => {
		taken = [];
		mocks.goto.mockClear();
		document.addEventListener('click', record);
	});

	afterEach(() => document.removeEventListener('click', record));

	function show() {
		render(TicketHostHarness, {
			props: { host: INBOX_HOST, component: Markdown, props: { source: LINKS } }
		});
	}

	it('opens a link to a ticket where the text stands with a plain click; the stored link stays', async () => {
		show();
		const link = screen.getByRole('link', { name: 'HAUS-1' });
		await fireEvent.click(link);

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			`/eingang/tickets/${TICKET}?quelle=mail&von=item00000000001`
		);
		expect(taken).toEqual([true]);
		expect(link.getAttribute('href')).toBe(`/tickets/${TICKET}`);
	});

	it.each([
		['Strg', { ctrlKey: true }],
		['Cmd', { metaKey: true }],
		['Umschalt', { shiftKey: true }],
		['Alt', { altKey: true }],
		['die mittlere Taste', { button: 1 }]
	])('leaves a click with %s to the browser (a new tab, /tickets/<id>)', async (_name, init) => {
		show();
		await fireEvent.click(screen.getByRole('link', { name: 'HAUS-1' }), init);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(taken).toEqual([false]);
	});

	it('leaves other links alone', async () => {
		show();
		await fireEvent.click(screen.getByRole('link', { name: 'Seite' }));
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(taken).toEqual([false]);
	});
});
