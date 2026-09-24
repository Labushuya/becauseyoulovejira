// Component tests for deleting a ticket (E2 plan, package 11; T-12, P-4): the dialog names the
// key and warns about comments and history, starts on "Abbrechen", Escape and "Abbrechen" keep
// the ticket (and the panel), confirming deletes exactly once, a failure shows in the dialog.
// jsdom has no showModal()/close(); the test adds a minimal stand-in, the product code is as is.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import TicketPanel from './TicketPanel.svelte';

const ID = 'abc123def456ghi';
const LIST = '/' as ResolvedPathname;

const nativeDialog = {
	showModal: HTMLDialogElement.prototype.showModal,
	close: HTMLDialogElement.prototype.close
};

beforeAll(() => {
	if (typeof nativeDialog.showModal !== 'function') {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof nativeDialog.close !== 'function') {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.open = false;
			this.dispatchEvent(new Event('close'));
		};
	}
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
	HTMLDialogElement.prototype.close = nativeDialog.close;
});

function ticket(): Ticket {
	return {
		id: ID,
		key: 'TASK-12',
		title: 'Keller aufräumen',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z'
	};
}

async function renderPanel() {
	const data = {
		get: vi.fn(async () => ticket()),
		update: vi.fn(),
		create: vi.fn(),
		delete: vi.fn<TicketDetailData['delete']>(async () => undefined)
	} satisfies TicketDetailData;
	const listTickets = new SvelteMap<string, TicketSummary>([[ID, ticket()]]);
	const list = {
		find: (id: string) => listTickets.get(id) ?? null,
		upsert: vi.fn(),
		completed: vi.fn(),
		remove: vi.fn((id: string) => listTickets.delete(id)),
		announce: vi.fn()
	} satisfies TicketListSync;
	const store = new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
	const onclose = vi.fn();
	const ondeleted = vi.fn();
	store.open(ID);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		{ ensureValid: () => true, logout: vi.fn() }
	);
	render(TicketPanel, { props: { store, catalog, listHref: LIST, onclose, ondeleted } });
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	await tick();
	return { store, data, list, onclose, ondeleted };
}

function deleteButton() {
	return screen.getByRole('button', { name: 'Löschen …' });
}

async function openDialog() {
	await fireEvent.click(deleteButton());
	await tick();
	await tick();
	return screen.getByRole('dialog', { name: 'TASK-12 endgültig löschen?' });
}

describe('deleting a ticket', () => {
	it('asks with the key and warns that comments and history go as well', async () => {
		await renderPanel();
		expect(deleteButton().getAttribute('aria-haspopup')).toBe('dialog');

		const dialog = await openDialog();

		expect((dialog as HTMLDialogElement).open).toBe(true);
		const text = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
		expect(text?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Dabei werden auch alle Kommentare und der gesamte Verlauf dieses Tickets gelöscht. Das lässt sich nicht rückgängig machen.'
		);
		expect(within(dialog).getByRole('button', { name: 'Endgültig löschen' })).toBeTruthy();
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));
	});

	it('does not use the error color for "Endgültig löschen"', async () => {
		await renderPanel();
		const dialog = await openDialog();

		const confirm = within(dialog).getByRole('button', { name: 'Endgültig löschen' });
		expect(confirm.className).toContain('button-primary');
		expect(dialog.querySelector('.alert-error')).toBeNull();
	});

	it('keeps the ticket on "Abbrechen" and returns the focus', async () => {
		const { data, ondeleted } = await renderPanel();
		const dialog = await openDialog();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();

		expect((dialog as HTMLDialogElement).open).toBe(false);
		expect(data.delete).not.toHaveBeenCalled();
		expect(ondeleted).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(deleteButton());
	});

	it('cancels with Escape without closing the panel', async () => {
		const { data, onclose } = await renderPanel();
		const dialog = await openDialog();

		// The browser sends the key, then the cancel event of the modal dialog.
		const key = await fireEvent.keyDown(dialog, { key: 'Escape' });
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		await tick();

		expect(key).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
		expect((dialog as HTMLDialogElement).open).toBe(false);
		expect(data.delete).not.toHaveBeenCalled();
	});

	it('deletes exactly once on confirmation and hands over to the owner', async () => {
		const { data, list, ondeleted } = await renderPanel();
		let finish!: () => void;
		data.delete.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
		const dialog = await openDialog();
		const confirm = within(dialog).getByRole('button', { name: 'Endgültig löschen' });

		await fireEvent.click(confirm);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wird ausgeführt …' }));
		expect(dialog.getAttribute('aria-busy')).toBe('true');
		finish();

		await vi.waitFor(() => expect(ondeleted).toHaveBeenCalledOnce());
		expect(data.delete).toHaveBeenCalledExactlyOnceWith(ID);
		expect(list.remove).toHaveBeenCalledWith(ID);
		expect(list.announce).toHaveBeenCalledWith('TASK-12 wurde gelöscht.');
		expect((dialog as HTMLDialogElement).open).toBe(false);
	});

	it('shows a failure inside the dialog and keeps the ticket', async () => {
		const { data, list, ondeleted } = await renderPanel();
		data.delete.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		const dialog = await openDialog();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }));

		const alert = await within(dialog).findByRole('alert');
		expect(alert.className).toContain('alert-error');
		expect(alert.textContent).toMatch(/Der Server hat mit einem Fehler geantwortet/);
		expect((dialog as HTMLDialogElement).open).toBe(true);
		expect(ondeleted).not.toHaveBeenCalled();
		expect(list.remove).not.toHaveBeenCalled();
		expect(screen.getByRole('heading', { level: 2, name: 'Keller aufräumen' })).toBeTruthy();
	});
});
