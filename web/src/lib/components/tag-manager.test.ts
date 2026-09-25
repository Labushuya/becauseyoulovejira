// Component tests for the section "Tags" of the project view (E3 plan, T-14 and package 14):
// renaming inline (Enter saves, Escape cancels, conflicts at the field), deleting after the
// question with the number of tickets, focus afterwards. The question is the confirmation of
// ADR-0025 section 4 (since UI-3); jsdom has no showModal(), the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Tag } from '$lib/domain/tag';
import type { CatalogEditor, EditResult } from '$lib/stores/catalog-editor';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TagManager from './TagManager.svelte';

const T0 = '2026-09-24 08:00:00.000Z';
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: T0 };
const CALL: Tag = { id: 'tag000000000002', name: 'anrufen', updated: T0 };

useOverlayStubs();

type Editor = Pick<CatalogEditor, 'renameTag' | 'deleteTag' | 'countTicketsWithTag'>;

function show(tags: Tag[] = [CALL, GARDEN], overrides: Partial<Editor> = {}) {
	const editor = {
		renameTag: vi.fn(async (tag: Tag, name: string): Promise<EditResult<Tag>> => ({
			ok: true,
			value: { ...tag, name: name.trim() }
		})),
		deleteTag: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
		countTicketsWithTag: vi.fn(async (): Promise<EditResult<number>> => ({ ok: true, value: 3 })),
		...overrides
	};
	const onannounce = vi.fn();
	// The heading of the view (SectionBar) takes the focus when the deleted tag is gone (UI-6).
	for (const old of document.querySelectorAll('[data-view-heading]')) old.remove();
	const view = document.createElement('h2');
	view.textContent = 'Projekte';
	view.tabIndex = -1;
	view.dataset.viewHeading = '';
	document.body.append(view);
	const result = render(TagManager, { props: { tags, editor, onannounce } });
	return { editor, onannounce, ...result };
}

describe('tag manager', () => {
	it('lists the tags with their number and the actions per tag', () => {
		show();

		const section = screen.getByRole('region', { name: 'Tags' });
		expect(within(section).getByText('2 Tags')).toBeTruthy();
		expect(
			within(section)
				.getAllByRole('listitem')
				.map((item) => item.querySelector('.name')?.textContent)
		).toEqual(['anrufen', 'Garten']);
		expect(screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Tag „Garten“ löschen …' })).toBeTruthy();
	});

	it('says how tags come about when there are none', () => {
		show([]);

		expect(screen.getByText(/Noch keine Tags\./)).toBeTruthy();
	});

	it('renames inline: the field starts with the name, Enter saves, the focus returns', async () => {
		const { editor, onannounce } = show();

		await fireEvent.click(screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' }));
		await tick();
		const field = screen.getByRole<HTMLInputElement>('textbox', {
			name: 'Neuer Name für den Tag „Garten“'
		});
		expect(field.value).toBe('Garten');
		expect(document.activeElement).toBe(field);

		await fireEvent.input(field, { target: { value: 'Hof' } });
		await fireEvent.submit(field.form as HTMLFormElement);

		expect(editor.renameTag).toHaveBeenCalledExactlyOnceWith(GARDEN, 'Hof');
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' })
			)
		);
		expect(onannounce).toHaveBeenCalledWith('Tag heißt jetzt „Hof“.');
	});

	it('cancels renaming with Escape without a request', async () => {
		const { editor } = show();

		await fireEvent.click(screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' }));
		await tick();
		await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
		await tick();

		expect(screen.queryByRole('textbox')).toBeNull();
		expect(editor.renameTag).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' })
		);
	});

	it('shows a conflict at the field and keeps it open', async () => {
		show([CALL, GARDEN], {
			renameTag: vi.fn(async () => ({
				ok: false as const,
				message: null,
				fields: { name: 'Diesen Namen hat schon ein anderer Tag.' }
			}))
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' }));
		await tick();
		const field = screen.getByRole('textbox');
		await fireEvent.input(field, { target: { value: 'Anrufen' } });
		await fireEvent.submit(field.closest('form') as HTMLFormElement);

		await vi.waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
		expect(
			document.getElementById(String(field.getAttribute('aria-describedby')))?.textContent
		).toBe('Diesen Namen hat schon ein anderer Tag.');
	});

	it('asks with the number of tickets before deleting and deletes after confirming', async () => {
		const { editor, onannounce } = show();

		const trigger = screen.getByRole('button', { name: 'Tag „Garten“ löschen …' });
		trigger.focus();
		await fireEvent.click(trigger);

		const dialog = screen.getByRole('dialog', { name: 'Tag „Garten“ löschen?' });
		await vi.waitFor(() =>
			expect(dialog.textContent).toMatch(
				'Es wird bei 3 Tickets entfernt. Deren Verlauf zeigt die Änderung.'
			)
		);
		expect(editor.countTicketsWithTag).toHaveBeenCalledWith(GARDEN, {
			signal: expect.any(AbortSignal)
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));

		expect(editor.deleteTag).toHaveBeenCalledExactlyOnceWith(GARDEN);
		await vi.waitFor(() => expect(onannounce).toHaveBeenCalledWith('Tag „Garten“ gelöscht.'));
		// The list of this test keeps the tag, so the modal returns the focus to its button (the
		// fallback to the heading of the view when it is gone: modal.test.ts, UI-6).
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it('names one ticket, no ticket, and a count that failed', async () => {
		const counts: EditResult<number>[] = [
			{ ok: true, value: 1 },
			{ ok: true, value: 0 },
			{ ok: false, message: 'Server nicht erreichbar.', fields: {} }
		];
		const { container } = show([GARDEN], {
			countTicketsWithTag: vi.fn(
				async (): Promise<EditResult<number>> => counts.shift() ?? { ok: true, value: 0 }
			)
		});
		const dialog = () => container.querySelector('dialog') as HTMLDialogElement;

		for (const text of [
			'Es wird bei 1 Ticket entfernt.',
			'Kein Ticket trägt diesen Tag.',
			'Wie viele Tickets ihn tragen, ließ sich nicht ermitteln.'
		]) {
			const trigger = screen.getByRole('button', { name: 'Tag „Garten“ löschen …' });
			trigger.focus();
			await fireEvent.click(trigger);
			await vi.waitFor(() => expect(dialog().textContent).toMatch(text));
			await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(
					screen.getByRole('button', { name: 'Tag „Garten“ löschen …' })
				)
			);
		}
	});

	it('shows a failed deletion in the dialog', async () => {
		show([GARDEN], {
			deleteTag: vi.fn(async () => ({
				ok: false as const,
				message: 'Der Server hat mit einem Fehler geantwortet.',
				fields: {}
			}))
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Tag „Garten“ löschen …' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

		await vi.waitFor(() =>
			expect(screen.getByRole('alert').textContent).toMatch('Der Server hat mit einem Fehler')
		);
	});
});
