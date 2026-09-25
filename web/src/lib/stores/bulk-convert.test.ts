// "Gesammelt umwandeln" (E4 plan, package 3; ADR-0014 section 4): one entry after the other with
// the defaults, a result per entry, failures with their reason, no stop on a failure, stop on an
// ended session and on request.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import type { Ticket } from '$lib/domain/ticket';
import { BulkConverter, type BulkConvertData, type BulkDefaults } from './bulk-convert.svelte';

const DEFAULTS: BulkDefaults = {
	status: 'backlog',
	priority: 'high',
	project: 'proj00000000001',
	tags: ['tag000000000001']
};

function entry(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		id,
		channel: 'eml',
		kind: 'mail',
		title: `Mail ${id}`,
		body: 'Text',
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function ticket(n: number): Ticket {
	return {
		id: `tick0000000000${n}`,
		key: `HAUS-${n}`,
		title: `Mail ${n}`,
		description: 'Text',
		status: 'backlog',
		priority: 'high',
		due: null,
		projectId: 'proj00000000001',
		tagIds: ['tag000000000001'],
		project: null,
		tags: [],
		recurring: false,
		source: 'eml',
		sourceItem: null,
		completedAt: null,
		created: `2026-09-25 09:00:0${n}.000Z`,
		updated: `2026-09-25 09:00:0${n}.000Z`
	};
}

function setup(valid = true) {
	let next = 0;
	const data = {
		get: vi.fn<BulkConvertData['get']>(async (id) => entry(id)),
		createTicket: vi.fn<BulkConvertData['createTicket']>(async () => {
			next += 1;
			return ticket(next);
		})
	} satisfies BulkConvertData;
	const session = { ensureValid: vi.fn(() => valid), logout: vi.fn() };
	const sinks = { upsertTicket: vi.fn(), markConverted: vi.fn() };
	return { converter: new BulkConverter(data, session, sinks), data, session, sinks };
}

const ITEMS = [
	{ id: 'item00000000001', title: 'Eins' },
	{ id: 'item00000000002', title: 'Zwei' },
	{ id: 'item00000000003', title: 'Drei' }
];

describe('BulkConverter', () => {
	it('converts one entry after the other with the defaults and the text of each entry', async () => {
		const { converter, data, sinks } = setup();
		await converter.run(ITEMS, DEFAULTS);

		expect(data.createTicket).toHaveBeenCalledTimes(3);
		expect(data.createTicket).toHaveBeenNthCalledWith(
			1,
			{
				title: 'Mail item00000000001',
				description: 'Text',
				status: 'backlog',
				priority: 'high',
				due: null,
				project: 'proj00000000001',
				tags: ['tag000000000001']
			},
			{ sourceItem: 'item00000000001' }
		);
		expect(converter.converted).toBe(3);
		expect(converter.results.map((result) => (result.ok ? result.key : ''))).toEqual([
			'HAUS-1',
			'HAUS-2',
			'HAUS-3'
		]);
		expect(sinks.upsertTicket).toHaveBeenCalledTimes(3);
		expect(sinks.markConverted).toHaveBeenCalledWith(
			'item00000000002',
			'tick00000000002',
			'2026-09-25 09:00:02.000Z'
		);
		expect(converter.running).toBe(false);
	});

	it('keeps going after a failure and names the reason per entry', async () => {
		const { converter, data } = setup();
		data.createTicket.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					source_item: {
						code: 'validation_inbox_item_handled',
						message: 'Dieser Eintrag wurde schon bearbeitet.'
					}
				}
			})
		);
		data.get.mockImplementation(async (id) => {
			if (id === 'item00000000003') throw new DataError('not_found', { status: 404 });
			return entry(id);
		});

		await converter.run(ITEMS, DEFAULTS);
		expect(converter.total).toBe(3);
		expect(converter.converted).toBe(1);
		expect(converter.failed).toEqual([
			{
				id: 'item00000000001',
				title: 'Eins',
				ok: false,
				message: 'Dieser Eintrag wurde schon bearbeitet.'
			},
			{
				id: 'item00000000003',
				title: 'Drei',
				ok: false,
				message: 'Nicht gefunden. Der Eintrag wurde gelöscht oder ist nicht sichtbar.'
			}
		]);
	});

	it('stops when the session ends and after the current entry on request', async () => {
		const ended = setup();
		ended.data.createTicket.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await ended.converter.run(ITEMS, DEFAULTS);
		expect(ended.session.logout).toHaveBeenCalledOnce();
		expect(ended.converter.results).toEqual([]);
		expect(ended.data.get).toHaveBeenCalledOnce();

		const invalid = setup(false);
		await invalid.converter.run(ITEMS, DEFAULTS);
		expect(invalid.data.get).not.toHaveBeenCalled();

		const stopped = setup();
		stopped.data.get.mockImplementationOnce(async (id) => {
			stopped.converter.stop();
			return entry(id);
		});
		await stopped.converter.run(ITEMS, DEFAULTS);
		expect(stopped.converter.results).toHaveLength(1);
	});

	it('refuses a second run while one runs', async () => {
		const { converter, data } = setup();
		const first = converter.run(ITEMS, DEFAULTS);
		await converter.run(ITEMS, DEFAULTS);
		await first;
		expect(data.createTicket).toHaveBeenCalledTimes(3);
	});
});
