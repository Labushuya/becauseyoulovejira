// Markdown.svelte with tasks (ADR-0032 section 6, RT-2): without `ontoggletask` the checkboxes stay
// disabled; with it they can be ticked, are locked and busy while a change is saved, go back when
// saving fails, and are locked with a reason while `taskHint` is set.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Markdown from './Markdown.svelte';

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
