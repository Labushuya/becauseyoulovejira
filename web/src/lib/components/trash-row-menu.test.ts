// The menu "•••" of a row of the trash (plan aktionsmenues, AM-4): "Wiederherstellen" stays a
// symbol, "Endgültig löschen …" moves into the menu next to "Vorschau öffnen" and
// "Wiederherstellen"; a right click and Shift+F10 open the same menu (AM-3), never the selection,
// and the question of a restore keeps the menu of the browser. Real TrashStore on a fake data
// layer, the shared overlay stubs; page state is mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { ProjectRef } from '$lib/domain/ticket';
import type { TrashItem } from '$lib/domain/trash';
import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
import { TrashStore, type TrashData } from '$lib/stores/trash.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TrashView from './TrashView.svelte';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/papierkorb') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const A = 'ticket00000000a';
const B = 'ticket00000000b';
const PROJECTS: ProjectRef[] = [
	{ id: 'project00000001', name: 'Garten', code: 'GART', archived: false }
];

function item(id: string): TrashItem {
	return {
		id,
		key: id === A ? 'HAUS-1' : 'TASK-2',
		title: id === A ? 'Dach reparieren' : 'Keller',
		status: 'open',
		priority: 'medium',
		due: '',
		project: null,
		recurring: false,
		children: 0,
		dependencies: 0,
		deletedAt: '2026-09-28 10:00:00.000Z',
		deletedBy: 'user00000000001',
		updated: '2026-09-28 10:00:00.000Z',
		daysLeft: 30
	};
}

const RESTORED = {
	key: 'HAUS-1',
	updated: '',
	tickets: [],
	newKeys: [],
	parentDetached: false,
	ruleMissing: [],
	seriesDetached: [],
	sourcesSkipped: []
};

async function showView(overrides: Partial<TrashData> = {}) {
	const data: TrashData = {
		list: vi.fn(async () => ({ items: [item(A), item(B)], retention: '30' as const })),
		preview: vi.fn(),
		restore: vi.fn(async (id: string) => ({ id, ...RESTORED })),
		resolve: vi.fn(),
		purge: vi.fn(async () => undefined),
		purgeAll: vi.fn(async () => ({ purged: 2, blocked: [] })),
		saveRetention: vi.fn(async (value) => value),
		...overrides
	};
	const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() }, SILENT_FLAGS);
	await store.reload();
	render(TrashView, { props: { store, projects: PROJECTS, selfId: 'user00000000001' } });
	await tick();
	return { store, data };
}

function rowOf(title: string): HTMLElement {
	return screen.getByRole('link', { name: title }).closest('tr') as HTMLElement;
}

function menuButton(key = 'HAUS-1'): HTMLElement {
	return screen.getByRole('button', { name: `Weitere Aktionen für ${key}` });
}

function menuOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

function entry(name: string, key = 'HAUS-1'): HTMLElement {
	return within(menuOf(menuButton(key))).getByRole('menuitem', { name, hidden: true });
}

const isOpen = (key = 'HAUS-1') => menuButton(key).getAttribute('aria-expanded') === 'true';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('menu "•••" of a row of the trash (AM-4)', () => {
	it('keeps "Wiederherstellen" as a symbol and moves "Endgültig löschen …" into the menu', async () => {
		await showView();
		const actions = rowOf('Dach reparieren').querySelector('[data-col="actions"]') as HTMLElement;
		const buttons = [...actions.querySelectorAll('button')].filter(
			(button) => button.closest('[popover]') === null
		);
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'HAUS-1 wiederherstellen',
			'Weitere Aktionen für HAUS-1'
		]);
		expect(screen.queryByRole('button', { name: 'HAUS-1 endgültig löschen …' })).toBeNull();
		expect(menuButton().getAttribute('title')).toBe('Weitere Aktionen');
		expect(menuButton().getAttribute('aria-haspopup')).toBe('menu');
		expect(menuButton().classList.contains('row-menu')).toBe(true);
		expect(menuOf(menuButton()).getAttribute('aria-label')).toBe('Weitere Aktionen für HAUS-1');
	});

	it('offers the preview, restoring and deleting for good', async () => {
		await showView();
		const menu = within(menuOf(menuButton()));
		const entries = menu.getAllByRole('menuitem', { hidden: true });
		expect(entries.map((element) => element.textContent?.trim())).toEqual([
			'Vorschau öffnen',
			'Wiederherstellen',
			'Endgültig löschen …'
		]);
		expect(entries[0]?.getAttribute('href')).toBe(`/papierkorb/${A}`);
		expect(entries[2]?.getAttribute('aria-haspopup')).toBe('dialog');
		const lines = menu.getAllByRole('separator', { hidden: true });
		expect(lines.map((line) => line.nextElementSibling?.textContent?.trim())).toEqual([
			'Wiederherstellen',
			'Endgültig löschen …'
		]);
	});

	it('restores from the menu and asks before deleting for good', async () => {
		const { data } = await showView();
		await fireEvent.click(entry('Wiederherstellen'));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith(A, {}));

		await fireEvent.click(entry('Endgültig löschen …', 'TASK-2'));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'TASK-2 endgültig löschen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }));
		await vi.waitFor(() => expect(data.purge).toHaveBeenCalledExactlyOnceWith(B));
	});

	it('locks the entries while a restore of the row runs', async () => {
		let finish!: () => void;
		await showView({
			restore: vi.fn(
				(id: string) =>
					new Promise<typeof RESTORED & { id: string }>((resolve) => {
						finish = () => resolve({ id, ...RESTORED });
					})
			)
		});
		await fireEvent.click(screen.getByRole('button', { name: 'HAUS-1 wiederherstellen' }));
		await tick();

		expect(entry('Wiederherstellen').getAttribute('aria-busy')).toBe('true');
		expect(entry('Endgültig löschen …').getAttribute('aria-disabled')).toBe('true');
		finish();
		await vi.waitFor(() => expect(screen.queryByText('Dach reparieren')).toBeNull());
	});

	it('opens the menu with a right click at the pointer and never chooses the row', async () => {
		await showView();
		const key = within(rowOf('Dach reparieren')).getByText('HAUS-1');

		const kept = await fireEvent.contextMenu(key, { button: 2, clientX: 220, clientY: 140 });
		await tick();

		expect(kept).toBe(false);
		expect(isOpen()).toBe(true);
		expect(isOpen('TASK-2')).toBe(false);
		expect(menuOf(menuButton()).style.top).toBe('140px');
		expect(menuOf(menuButton()).style.left).toBe('220px');
		const select = screen.getByRole<HTMLInputElement>('checkbox', { name: 'HAUS-1 auswählen' });
		await fireEvent.contextMenu(select.closest('td') as HTMLElement, { button: 2 });
		expect(select.checked).toBe(false);
		expect(screen.queryByRole('region', { name: /ausgewählt/ })).toBeNull();
	});

	it('opens it with Shift+F10 on the title and gives the focus back with Escape', async () => {
		await showView();
		const title = screen.getByRole('link', { name: 'Keller' });
		title.focus();

		expect(await fireEvent.keyDown(title, { key: 'F10', shiftKey: true })).toBe(false);
		await tick();
		expect(isOpen('TASK-2')).toBe(true);
		expect(document.activeElement?.textContent?.trim()).toBe('Vorschau öffnen');

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(isOpen('TASK-2')).toBe(false);
		expect(document.activeElement).toBe(title);
	});

	it('keeps the menu of the browser in the question of a restore', async () => {
		await showView({
			restore: vi.fn().mockRejectedValue(
				new DataError('validation', {
					status: 400,
					fields: {
						project: {
							code: 'validation_trash_project_required',
							message: 'Bitte ein Zielprojekt wählen.',
							params: { code: 'HAUS', reason: 'missing' }
						}
					}
				})
			)
		});
		await fireEvent.click(entry('Wiederherstellen'));
		const target = await vi.waitFor(() => screen.getByLabelText('Zielprojekt für HAUS-1'));

		expect(await fireEvent.contextMenu(target, { button: 2 })).toBe(true);
		expect(await fireEvent.keyDown(target, { key: 'F10', shiftKey: true })).toBe(true);
		expect(isOpen()).toBe(false);
	});
});
