// Confirmation (ADR-0025 section 4; plan UI-Konsistenz, package UI-3): size S, question as title,
// text as description, focus on "Abbrechen", Escape, × and veil mean "Abbrechen", locked while
// busy, failure inside, no red.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ConfirmDialog from './ConfirmDialog.svelte';
import source from './ConfirmDialog.svelte?raw';

useOverlayStubs();

const text = createRawSnippet(() => ({
	render: () => '<p>Der Kommentar wird endgültig gelöscht.</p>'
}));

async function show(props: Record<string, unknown> = {}) {
	const onconfirm = vi.fn();
	const oncancel = vi.fn();
	const view = render(ConfirmDialog, {
		props: {
			open: true,
			title: 'Kommentar löschen?',
			confirmLabel: 'Löschen',
			onconfirm,
			oncancel,
			children: text,
			...props
		}
	});
	await tick();
	await tick();
	const dialog = screen.getByRole<HTMLDialogElement>('dialog', {
		hidden: true,
		name: 'Kommentar löschen?'
	});
	return { onconfirm, oncancel, dialog, view };
}

describe('confirm dialog', () => {
	it('is a small modal with the question, the text as description and focus on "Abbrechen"', async () => {
		const { dialog } = await show();

		expect(dialog.open).toBe(true);
		expect(dialog.className).toContain('size-s');
		const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
		expect(description?.textContent?.trim()).toBe('Der Kommentar wird endgültig gelöscht.');
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));
	});

	it('names the cancel button as asked ("Weiter bearbeiten")', async () => {
		const { dialog } = await show({ cancelLabel: 'Weiter bearbeiten', confirmLabel: 'Verwerfen' });

		expect(
			within(dialog)
				.getAllByRole('button')
				.map((button) => button.textContent?.trim() || button.getAttribute('aria-label'))
		).toEqual(['Schließen', 'Weiter bearbeiten', 'Verwerfen']);
	});

	it.each(['Escape', '×', 'veil', 'Abbrechen'])('cancels with %s', async (way) => {
		const { oncancel, onconfirm, dialog } = await show();

		if (way === 'Escape') await fireEvent.keyDown(dialog, { key: 'Escape' });
		else if (way === 'veil') {
			await fireEvent.pointerDown(dialog);
			await fireEvent.click(dialog);
		} else {
			const name = way === '×' ? 'Schließen' : way;
			await fireEvent.click(within(dialog).getByRole('button', { name }));
		}

		expect(oncancel).toHaveBeenCalledOnce();
		expect(onconfirm).not.toHaveBeenCalled();
	});

	it('confirms with the verb', async () => {
		const { onconfirm, oncancel, dialog } = await show();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));

		expect(onconfirm).toHaveBeenCalledOnce();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('locks every way while busy and says "Wird ausgeführt …"', async () => {
		const { onconfirm, oncancel, dialog } = await show({ busy: true });

		const running = within(dialog).getByRole('button', { name: 'Wird ausgeführt …' });
		await fireEvent.click(running);
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));

		expect(onconfirm).not.toHaveBeenCalled();
		expect(oncancel).not.toHaveBeenCalled();
		expect(dialog.getAttribute('aria-busy')).toBe('true');
		expect(running.getAttribute('aria-disabled')).toBe('true');
	});

	it('shows a failure inside as an alert with icon', async () => {
		const { dialog } = await show({ error: 'Der Server antwortet nicht.' });

		const alert = within(dialog).getByRole('alert');
		expect(alert.className).toContain('alert-error');
		expect(alert.querySelector('svg')).not.toBeNull();
		expect(alert.textContent?.trim()).toBe('Der Server antwortet nicht.');
	});

	it('uses no red for the verb (ADR-0009) and no own dialog or backdrop', () => {
		expect(source).not.toMatch(/danger|<dialog|::backdrop|box-shadow/);
		expect(source).toMatch(/button-primary/);
	});
});
