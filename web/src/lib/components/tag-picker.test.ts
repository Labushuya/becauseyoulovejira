// Component tests for the tag picker (E3 plan, T-14 and package 8): combobox attributes after the
// WAI-ARIA pattern, filtered suggestions, choosing by keyboard and mouse, creating a new tag,
// removing chips by keyboard, the lock during a request and the length limit.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { TagRef } from '$lib/domain/ticket';
import TagPicker from './TagPicker.svelte';

const GARDEN: TagRef = { id: 'tag000000000001', name: 'Garten' };
const CALL: TagRef = { id: 'tag000000000002', name: 'anrufen' };
const ROOF: TagRef = { id: 'tag000000000003', name: 'Dachgarten' };

function deferred() {
	let resolve!: (value: boolean) => void;
	const promise = new Promise<boolean>((res) => (resolve = res));
	return { promise, resolve };
}

function renderPicker(props: Record<string, unknown> = {}) {
	const onadd = vi.fn(async () => true);
	const onremove = vi.fn(async () => true);
	const oncreate = vi.fn(async () => true);
	const result = render(TagPicker, {
		props: {
			id: 'tags',
			selected: [],
			tags: [CALL, ROOF, GARDEN],
			errorId: 'tags-error',
			onadd,
			onremove,
			oncreate,
			...props
		}
	});
	const input = screen.getByRole<HTMLInputElement>('combobox');
	return { ...result, input, onadd, onremove, oncreate };
}

function listbox() {
	return screen.getByRole('listbox', { hidden: true });
}

function optionTexts() {
	return within(listbox())
		.queryAllByRole('option', { hidden: true })
		.map((option) => option.textContent?.trim());
}

async function type(input: HTMLInputElement, value: string) {
	await fireEvent.input(input, { target: { value } });
}

describe('tag picker', () => {
	it('is a combobox with a listbox after the WAI-ARIA pattern', async () => {
		const { input } = renderPicker();

		expect(input.getAttribute('aria-autocomplete')).toBe('list');
		expect(input.getAttribute('aria-controls')).toBe(listbox().id);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(input.getAttribute('aria-activedescendant')).toBeNull();
		expect(input.maxLength).toBe(50);
		expect(listbox().hidden).toBe(true);

		await type(input, 'gar');

		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(listbox().hidden).toBe(false);
		const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
		expect(active?.getAttribute('role')).toBe('option');
		expect(active?.getAttribute('aria-selected')).toBe('true');
		expect(active?.textContent?.trim()).toBe('Garten');
	});

	it('filters the suggestions and offers to create a new tag last', async () => {
		const { input } = renderPicker({ selected: [ROOF] });

		await type(input, 'gar');
		expect(optionTexts()).toEqual(['Garten', '„gar“ als neuen Tag anlegen']);

		await type(input, '  GARTEN ');
		expect(optionTexts()).toEqual(['Garten']);
	});

	it('moves with the arrow keys and chooses with Enter', async () => {
		const { input, onadd } = renderPicker();

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(optionTexts()).toEqual(['anrufen', 'Dachgarten', 'Garten']);
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
		expect(active?.textContent?.trim()).toBe('Garten');
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(onadd).toHaveBeenCalledExactlyOnceWith(GARDEN.id);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(input);
	});

	it('chooses with the mouse without taking the focus from the input', async () => {
		const { input, onadd } = renderPicker();
		input.focus();
		await type(input, 'an');

		const option = within(listbox()).getByRole('option', { name: 'anrufen' });
		const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		option.dispatchEvent(mousedown);
		expect(mousedown.defaultPrevented).toBe(true);
		await fireEvent.click(option);
		await tick();

		expect(onadd).toHaveBeenCalledWith(CALL.id);
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
	});

	it('creates a new tag from the trimmed input', async () => {
		const { input, oncreate, onadd } = renderPicker();

		await type(input, '  Steuer ');
		expect(optionTexts()).toEqual(['„Steuer“ als neuen Tag anlegen']);
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(oncreate).toHaveBeenCalledExactlyOnceWith('Steuer');
		expect(onadd).not.toHaveBeenCalled();
		expect(input.value).toBe('');
	});

	it('creates once for a quick double Enter and locks while the request runs', async () => {
		const answer = deferred();
		const oncreate = vi.fn(() => answer.promise);
		const { input } = renderPicker({ oncreate });

		await type(input, 'Steuer');
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(oncreate).toHaveBeenCalledOnce();
		expect(input.getAttribute('aria-busy')).toBe('true');
		answer.resolve(true);
		await vi.waitFor(() => expect(input.getAttribute('aria-busy')).toBeNull());
	});

	it('keeps the input when the owner reports a failure', async () => {
		const { input } = renderPicker({ oncreate: vi.fn(async () => false) });

		await type(input, 'Steuer');
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(input.value).toBe('Steuer');
	});

	it('does nothing while the owner saves', async () => {
		const { input, onadd, onremove } = renderPicker({ busy: true, selected: [GARDEN] });

		await type(input, 'an');
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(screen.getByRole('button', { name: 'Tag Garten entfernen' }));

		expect(onadd).not.toHaveBeenCalled();
		expect(onremove).not.toHaveBeenCalled();
		expect(input.getAttribute('aria-busy')).toBe('true');
	});

	it('closes with Escape, then clears the input with a second Escape', async () => {
		const { input } = renderPicker();
		await type(input, 'gar');

		const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(first);
		await tick();
		expect(first.defaultPrevented).toBe(true);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(input.value).toBe('gar');

		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('');

		const third = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(third);
		expect(third.defaultPrevented).toBe(false);
	});

	it('leaves Ctrl+Enter to the form around and keeps plain Enter from submitting it', async () => {
		const { input } = renderPicker();
		await type(input, 'gar');

		const ctrl = new KeyboardEvent('keydown', {
			key: 'Enter',
			ctrlKey: true,
			bubbles: true,
			cancelable: true
		});
		input.dispatchEvent(ctrl);
		expect(ctrl.defaultPrevented).toBe(false);

		await fireEvent.keyDown(input, { key: 'Escape' });
		await fireEvent.keyDown(input, { key: 'Escape' });
		const plain = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input.dispatchEvent(plain);
		expect(plain.defaultPrevented).toBe(true);
	});

	it('shows chosen tags as chips that can be removed by keyboard, then focuses the input', async () => {
		const { input, onremove } = renderPicker({ selected: [GARDEN, CALL] });

		const chips = screen.getByRole('list', { name: 'Gewählte Tags' });
		expect(
			within(chips)
				.getAllByRole('listitem')
				.map((chip) => chip.textContent?.trim())
		).toEqual(['Garten', 'anrufen']);
		const remove = screen.getByRole('button', { name: 'Tag anrufen entfernen' });
		remove.focus();
		await fireEvent.click(remove);
		await tick();

		expect(onremove).toHaveBeenCalledExactlyOnceWith(CALL.id);
		expect(document.activeElement).toBe(input);
	});

	it('shows an error at the input', () => {
		const { input } = renderPicker({ error: 'Schon vergeben.', describedBy: 'hint' });

		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('hint tags-error');
	});

	it('offers no new tag for a name that is too long or taken in another spelling', async () => {
		const { input } = renderPicker({ selected: [GARDEN] });

		await type(input, 'x'.repeat(51));
		expect(optionTexts()).toEqual([]);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		await type(input, 'GARTEN');
		// Garten is chosen already; only the other tag containing the name is left.
		expect(optionTexts()).toEqual(['Dachgarten']);
	});
});
