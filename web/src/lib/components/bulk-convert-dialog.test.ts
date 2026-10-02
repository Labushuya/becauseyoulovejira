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

describe('bulk convert dialog: "Datum des Termins als Fälligkeit" (plan BI-2)', () => {
	const EVENTS = [
		{
			id: 'item00000000001',
			title: 'Termin',
			kind: 'event' as const,
			sourceDate: '2026-10-05 07:30:00.000Z'
		},
		{
			id: 'item00000000002',
			title: 'Mail',
			kind: 'mail' as const,
			sourceDate: '2026-10-01 08:00:00.000Z'
		}
	];
	/** Entries from Notion: their date comes from the list, like an appointment (ADR-0041 §8). */
	const NOTION = [
		{
			id: 'item00000000001',
			title: 'Termin',
			kind: 'event' as const,
			channel: 'ics' as const,
			sourceDate: '2026-10-05 07:30:00.000Z'
		},
		{
			id: 'item00000000002',
			title: 'Fenster putzen',
			kind: 'task' as const,
			channel: 'notion' as const,
			sourceDate: '2026-10-04 22:00:00.000Z'
		},
		{
			id: 'item00000000003',
			title: 'Ohne Datum',
			kind: 'todo' as const,
			channel: 'notion' as const,
			sourceDate: null
		}
	];

	function showWith(items: typeof EVENTS | typeof ITEMS | typeof NOTION) {
		const converter = new BulkConverter(
			{ get: vi.fn(async (id: string) => entry(id)), createTicket: vi.fn(async () => ticket(1)) },
			{ ensureValid: () => true, logout: vi.fn() },
			{ upsertTicket: vi.fn(), markConverted: vi.fn() }
		);
		const run = vi.spyOn(converter, 'run');
		render(BulkConvertDialog, {
			props: { items, converter, projects: [HOUSE], tags: [], onclose: vi.fn() }
		});
		return { run };
	}

	it('offers the checkbox only among chosen events, off at first, and names how many it touches', async () => {
		const { run } = showWith(EVENTS);
		await tick();
		const dialog = within(screen.getByRole('dialog'));
		const check = dialog.getByRole<HTMLInputElement>('checkbox', {
			name: 'Datum des Termins als Fälligkeit'
		});
		expect(check.checked).toBe(false);
		expect(
			dialog.getByText('Gilt für 1 Termin; andere Einträge bleiben ohne Fälligkeit.')
		).toBeTruthy();

		await fireEvent.click(check);
		await fireEvent.click(dialog.getByRole('button', { name: '2 Einträge umwandeln' }));

		expect(run).toHaveBeenCalledWith(EVENTS, expect.objectContaining({ dueFromEvent: true }));
	});

	it('counts Notion entries with a date as well and says so (ADR-0041 §8)', async () => {
		const { run } = showWith(NOTION);
		await tick();
		const dialog = within(screen.getByRole('dialog'));
		const check = dialog.getByRole<HTMLInputElement>('checkbox', {
			name: 'Datum des Termins als Fälligkeit'
		});
		expect(check.checked).toBe(false);
		expect(
			dialog.getByText(
				'Gilt für 2 Einträge mit Datum aus Terminen oder aus Notion; andere Einträge bleiben ohne Fälligkeit.'
			)
		).toBeTruthy();

		await fireEvent.click(check);
		await fireEvent.click(dialog.getByRole('button', { name: '3 Einträge umwandeln' }));

		expect(run).toHaveBeenCalledWith(NOTION, expect.objectContaining({ dueFromEvent: true }));
	});

	it('has no checkbox without events', async () => {
		showWith(ITEMS);
		await tick();
		expect(screen.queryByRole('checkbox', { name: 'Datum des Termins als Fälligkeit' })).toBeNull();
	});
});

describe('bulk convert dialog: target projects of the entries (ADR-0049)', () => {
	const GARDEN: ProjectRef = {
		id: 'proj00000000002',
		name: 'Garten',
		code: 'GART',
		archived: false
	};
	const OLD: ProjectRef = { id: 'proj00000000003', name: 'Alt', code: 'ALT', archived: true };
	const WITH_TARGETS = [
		{ id: 'item00000000001', title: 'Eins', targetProjectId: GARDEN.id, sourceMeta: {} },
		{ id: 'item00000000002', title: 'Zwei', targetProjectId: OLD.id, sourceMeta: {} },
		{ id: 'item00000000003', title: 'Drei', targetProjectId: null, sourceMeta: {} },
		{
			id: 'item00000000004',
			title: 'Vier',
			targetProjectId: null,
			sourceMeta: { target_gone: true }
		}
	];

	function showTargets(items: typeof WITH_TARGETS) {
		const data = {
			get: vi.fn<BulkConvertData['get']>(async (id) => entry(id)),
			createTicket: vi.fn<BulkConvertData['createTicket']>(async () => ticket(1))
		} satisfies BulkConvertData;
		const converter = new BulkConverter(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			{ upsertTicket: vi.fn(), markConverted: vi.fn() }
		);
		render(BulkConvertDialog, {
			props: {
				items,
				converter,
				projects: [HOUSE, GARDEN],
				catalogProjects: [HOUSE, GARDEN, OLD],
				tags: [],
				onclose: vi.fn()
			}
		});
		return { data, dialog: within(screen.getByRole('dialog')) };
	}

	it('gives each entry its active target, the others the project of the dialog, and says so', async () => {
		const { data, dialog } = showTargets(WITH_TARGETS);
		await tick();
		const check = dialog.getByRole<HTMLInputElement>('checkbox', {
			name: 'Zielprojekt des Eintrags verwenden'
		});
		expect(check.checked).toBe(true);
		expect(
			dialog.getByText(
				'1 Eintrag hat ein Zielprojekt; die übrigen bekommen das Projekt unten. 2 Einträge haben ein archiviertes oder gelöschtes Zielprojekt; es wird nicht übernommen, sie bekommen das Projekt unten.'
			)
		).toBeTruthy();
		expect(dialog.getByText(/^Gilt für Einträge ohne Zielprojekt/)).toBeTruthy();

		await fireEvent.change(dialog.getByLabelText('Projekt'), { target: { value: HOUSE.id } });
		await fireEvent.click(dialog.getByRole('button', { name: '4 Einträge umwandeln' }));
		await vi.waitFor(() => expect(data.createTicket).toHaveBeenCalledTimes(4));
		const projects = data.createTicket.mock.calls.map(([draft, origin]) => [
			'sourceItem' in origin ? origin.sourceItem : null,
			draft.project
		]);
		expect(projects).toEqual([
			['item00000000001', GARDEN.id],
			['item00000000002', HOUSE.id],
			['item00000000003', HOUSE.id],
			['item00000000004', HOUSE.id]
		]);
	});

	it('takes the project of the dialog for every entry once switched off', async () => {
		const { data, dialog } = showTargets(WITH_TARGETS.slice(0, 1));
		await tick();
		await fireEvent.click(
			dialog.getByRole('checkbox', { name: 'Zielprojekt des Eintrags verwenden' })
		);
		await fireEvent.click(dialog.getByRole('button', { name: '1 Eintrag umwandeln' }));
		await vi.waitFor(() => expect(data.createTicket).toHaveBeenCalledTimes(1));
		expect(data.createTicket.mock.calls[0]?.[0].project).toBeNull();
	});

	it('names an unusable target without a checkbox when no entry has an active one', async () => {
		const { dialog } = showTargets(WITH_TARGETS.slice(1, 2));
		await tick();
		expect(
			dialog.queryByRole('checkbox', { name: 'Zielprojekt des Eintrags verwenden' })
		).toBeNull();
		expect(
			dialog.getByText(
				'1 Eintrag hat ein archiviertes oder gelöschtes Zielprojekt; es wird nicht übernommen, der Eintrag bekommt das Projekt unten.'
			)
		).toBeTruthy();
	});
});
