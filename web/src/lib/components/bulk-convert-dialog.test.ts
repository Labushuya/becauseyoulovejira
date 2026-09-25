// Component tests for "Gesammelt umwandeln" (E4 plan, package 3; ADR-0014 section 4): modal dialog
// with the defaults, progress, failures per entry with their reason, converted entries stay, no
// due date. The converter is real with fake data.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import type { ProjectRef, Ticket } from '$lib/domain/ticket';
import { BulkConverter, type BulkConvertData } from '$lib/stores/bulk-convert.svelte';
import BulkConvertDialog from './BulkConvertDialog.svelte';
import source from './BulkConvertDialog.svelte?raw';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const HOUSE: ProjectRef = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false
};

const ITEMS = [
	{ id: 'item00000000001', title: 'Eins' },
	{ id: 'item00000000002', title: 'Zwei' },
	{ id: 'item00000000003', title: 'Drei' }
];

function entry(id: string): InboxItem {
	return {
		id,
		channel: 'manual',
		kind: 'todo',
		title: `Eintrag ${id.slice(-1)}`,
		body: '',
		sourceUrl: '',
		sourceRef: '',
		sourceDate: '2026-09-30 10:00:00.000Z',
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z'
	};
}

function ticket(n: number): Ticket {
	return {
		id: `tick0000000000${n}`,
		key: `HAUS-${n}`,
		title: `Eintrag ${n}`,
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: HOUSE.id,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: 'manual',
		sourceItem: null,
		completedAt: null,
		created: '2026-09-25 09:00:00.000Z',
		updated: '2026-09-25 09:00:00.000Z'
	};
}

function show() {
	let next = 0;
	const data = {
		get: vi.fn<BulkConvertData['get']>(async (id) => entry(id)),
		createTicket: vi.fn<BulkConvertData['createTicket']>(async () => {
			next += 1;
			if (next === 2) {
				throw new DataError('validation', {
					status: 400,
					fields: {
						project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
					}
				});
			}
			return ticket(next);
		})
	} satisfies BulkConvertData;
	const converter = new BulkConverter(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		{ upsertTicket: vi.fn(), markConverted: vi.fn() }
	);
	const onclose = vi.fn();
	render(BulkConvertDialog, {
		props: { items: ITEMS, converter, projects: [HOUSE], tags: [], onclose }
	});
	return { data, onclose };
}

describe('bulk convert dialog', () => {
	it('asks for status, priority, project and tags in a modal dialog', async () => {
		show();
		await tick();
		const dialog = screen.getByRole('dialog', { name: '3 Einträge umwandeln' });
		expect((dialog as HTMLDialogElement).open).toBe(true);
		expect(within(dialog).getByLabelText<HTMLSelectElement>('Status').value).toBe('open');
		expect(within(dialog).getByLabelText<HTMLSelectElement>('Priorität').value).toBe('medium');
		expect(within(dialog).getByLabelText('Projekt')).toBeTruthy();
		expect(within(dialog).getByLabelText('Tags')).toBeTruthy();
		expect(within(dialog).queryByLabelText('Fälligkeit')).toBeNull();
		await vi.waitFor(() =>
			expect(document.activeElement?.id).toBe(within(dialog).getByLabelText('Status').id)
		);
	});

	it('converts with the chosen values, shows the progress and the failures per entry', async () => {
		const { data, onclose } = show();
		await tick();
		const dialog = within(screen.getByRole('dialog'));
		await fireEvent.change(dialog.getByLabelText('Status'), { target: { value: 'backlog' } });
		await fireEvent.change(dialog.getByLabelText('Priorität'), { target: { value: 'high' } });
		await fireEvent.change(dialog.getByLabelText('Projekt'), { target: { value: HOUSE.id } });
		await fireEvent.click(dialog.getByRole('button', { name: '3 Einträge umwandeln' }));

		await vi.waitFor(() =>
			expect(dialog.getByText('2 Einträge umgewandelt, 1 nicht umgewandelt.')).toBeTruthy()
		);
		expect(data.createTicket).toHaveBeenCalledTimes(3);
		expect(data.createTicket).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'backlog',
				priority: 'high',
				project: HOUSE.id,
				due: null
			}),
			{ sourceItem: 'item00000000001' }
		);
		const progress = dialog.getByRole('progressbar');
		expect(progress.getAttribute('value')).toBe('3');
		expect(progress.getAttribute('max')).toBe('3');
		const failures = within(
			dialog.getByRole('heading', { name: 'Nicht umgewandelt' }).parentElement!
		);
		expect(failures.getByText('„Zwei“: Das Projekt ist archiviert.')).toBeTruthy();
		expect(dialog.getByRole('link', { name: 'HAUS-1' }).getAttribute('href')).toBe(
			'/tickets/tick00000000001'
		);

		// After the run the footer says "Schließen", like the × in the header; the focus is on it.
		const [cross, close] = dialog.getAllByRole('button', { name: 'Schließen' });
		expect(cross?.getAttribute('aria-label')).toBe('Schließen');
		await vi.waitFor(() => expect(document.activeElement).toBe(close));
		await fireEvent.click(close as HTMLElement);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('closes on "Abbrechen" and Escape before the run', async () => {
		const { onclose, data } = show();
		await tick();
		const dialog = screen.getByRole('dialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(data.createTicket).not.toHaveBeenCalled();
	});

	it('is a modal of size M with × on the modal building block', async () => {
		const { onclose } = show();
		await tick();
		const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: '3 Einträge umwandeln' });
		expect(dialog.classList.contains('size-m')).toBe(true);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		expect(onclose).toHaveBeenCalledOnce();
		expect(source).not.toMatch(/<dialog|::backdrop|showModal/);
	});

	it('keeps its own Escape rule while running: "Anhalten", never closing (plan UI-4)', async () => {
		const release: (() => void)[] = [];
		const data = {
			get: vi.fn<BulkConvertData['get']>(async (id) => entry(id)),
			createTicket: vi.fn<BulkConvertData['createTicket']>(
				() =>
					new Promise<Ticket>((resolve) => {
						release.push(() => resolve(ticket(release.length)));
					})
			)
		} satisfies BulkConvertData;
		const converter = new BulkConverter(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			{ upsertTicket: vi.fn(), markConverted: vi.fn() }
		);
		const stop = vi.spyOn(converter, 'stop');
		const onclose = vi.fn();
		render(BulkConvertDialog, {
			props: { items: ITEMS, converter, projects: [HOUSE], tags: [], onclose }
		});
		await tick();
		const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: '3 Einträge umwandeln' });
		await fireEvent.click(within(dialog).getByRole('button', { name: '3 Einträge umwandeln' }));
		await vi.waitFor(() => expect(release).toHaveLength(1));
		expect(dialog.getAttribute('aria-busy')).toBe('true');

		// Twice Escape (Chromium's close watcher), × and the veil: the run stops, nothing closes.
		expect(await fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false);
		expect(await fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false);
		expect(stop).toHaveBeenCalledTimes(2);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		await fireEvent.pointerDown(dialog);
		await fireEvent.click(dialog);
		expect(onclose).not.toHaveBeenCalled();
		expect(dialog.open).toBe(true);

		release[0]?.();
		await vi.waitFor(() => expect(within(dialog).getByText('1 Eintrag umgewandelt.')).toBeTruthy());
		expect(data.createTicket).toHaveBeenCalledOnce();
		expect(dialog.getAttribute('aria-busy')).toBe('false');
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('marks failures with icon and text only', () => {
		expect(source).toMatch(/class="alert-error failures"/);
		expect(source.replace(/alert-error/g, '')).not.toMatch(/danger/);
	});
});
