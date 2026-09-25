// Component tests for the tag picker (E3 plan, T-14 and package 8): combobox attributes after the
// WAI-ARIA pattern, filtered suggestions, choosing by keyboard and mouse, creating a new tag,
// removing chips by keyboard, the lock during a request and the length limit. Since UI-9 the list
// lies in the top layer (popover="manual"): the shared stubs stand in for the popover API, and a
// harness opens the picker inside a modal. jsdom counts every popover as hidden, so options are
// found with { hidden: true }; the look in the browsers is BYL-E6-026.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { TagRef } from '$lib/domain/ticket';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TagPickerModalHarness from '$lib/test/TagPickerModalHarness.svelte';
import TagPicker from './TagPicker.svelte';
import source from './TagPicker.svelte?raw';

const GARDEN: TagRef = { id: 'tag000000000001', name: 'Garten' };
const CALL: TagRef = { id: 'tag000000000002', name: 'anrufen' };
const ROOF: TagRef = { id: 'tag000000000003', name: 'Dachgarten' };

useOverlayStubs();

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

		const option = within(listbox()).getByRole('option', { hidden: true, name: 'anrufen' });
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

describe('tag picker: list in the top layer (UI-9)', () => {
	it('shows the list as a manual popover below the input and hides it again', async () => {
		const { input } = renderPicker();
		expect(listbox().getAttribute('popover')).toBe('manual');
		expect(listbox().matches(':popover-open')).toBe(false);

		await type(input, 'gar');
		await tick();
		expect(listbox().matches(':popover-open')).toBe(true);
		expect(listbox().hidden).toBe(false);
		// jsdom has no layout: the input sits at 0, so the list starts 4 px below it and keeps the
		// margin of 8 px to the edge of the window.
		expect(listbox().style.top).toBe('4px');
		expect(listbox().style.left).toBe('8px');
		expect(listbox().style.width).toBe('0px');

		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		expect(listbox().matches(':popover-open')).toBe(false);
		expect(listbox().hidden).toBe(true);
		expect(input.getAttribute('aria-expanded')).toBe('false');
	});

	it('follows scrolling while it is open', async () => {
		const { input } = renderPicker();
		await type(input, 'gar');
		await tick();
		input.getBoundingClientRect = () => new DOMRect(40, 100, 200, 30);

		window.dispatchEvent(new Event('scroll'));
		expect(listbox().style.top).toBe('134px');
		expect(listbox().style.left).toBe('40px');
		expect(listbox().style.width).toBe('200px');
	});

	it('opens from within a modal and consumes Escape, so the modal stays open', async () => {
		const onreason = vi.fn();
		render(TagPickerModalHarness, { props: { tags: [CALL, ROOF, GARDEN], onreason } });
		await tick();
		const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Gesammelt umwandeln' });
		const input = within(dialog).getByRole<HTMLInputElement>('combobox');
		input.focus();

		await type(input, 'gar');
		await tick();
		const list = listbox();
		expect(dialog.contains(list)).toBe(true);
		expect(list.matches(':popover-open')).toBe(true);

		// First Escape closes the list, the second empties the field; both stay in the picker.
		const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(first);
		await tick();
		expect(first.defaultPrevented).toBe(true);
		expect(list.matches(':popover-open')).toBe(false);
		expect(dialog.open).toBe(true);
		const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		input.dispatchEvent(second);
		await tick();
		expect(second.defaultPrevented).toBe(true);
		expect(input.value).toBe('');
		expect(dialog.open).toBe(true);
		expect(onreason).not.toHaveBeenCalled();

		// With the list closed and the field empty, Escape belongs to the modal again.
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(onreason).toHaveBeenCalledExactlyOnceWith('escape');
	});

	it('chooses a suggestion with the mouse inside the modal', async () => {
		render(TagPickerModalHarness, { props: { tags: [CALL, ROOF, GARDEN] } });
		await tick();
		const input = screen.getByRole<HTMLInputElement>('combobox');
		input.focus();
		await type(input, 'an');
		await tick();

		await fireEvent.click(within(listbox()).getByRole('option', { hidden: true, name: 'anrufen' }));
		await tick();
		expect(screen.getByRole('list', { name: 'Gewählte Tags' }).textContent).toContain('anrufen');
		expect(listbox().matches(':popover-open')).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it('uses the popover surface and no own positioning in the flow', () => {
		expect(source).toMatch(/import \{ place \} from '\$lib\/overlay\/position';/);
		expect(source).not.toMatch(/z-index|position: absolute/);
		expect(source).toMatch(
			/\.listbox \{[^}]*position: fixed;[^}]*border-radius: var\(--radius-surface\)/
		);
	});
});
