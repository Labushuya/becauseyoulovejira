// Test data (storage.test.ts, storage-view.test.ts, ADR-0047): an answer of GET /api/byl/storage
// as the server sends it, for the folder app under Windows; `overrides` replace whole parts.

export function storageAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const none = { count: 0, bytes: 0, oldest: null, newest: null };
	return {
		measured_at: '2026-10-02T08:00:00.000Z',
		own_instance: true,
		database: {
			bytes: 50 * 1024 ** 2,
			wal_bytes: 0,
			free_bytes: 6 * 1024 ** 2,
			groups: {
				tickets: 20 * 1024 ** 2,
				history: 15 * 1024 ** 2,
				inbox: 10 * 1024 ** 2,
				other: 5 * 1024 ** 2
			},
			trash: { tickets: 3, bytes: 4096, blocked: 1 }
		},
		logs_database: { bytes: 2 * 1024 ** 2, wal_bytes: null, free_bytes: 0 },
		files: {
			total: { count: 4, bytes: 30 * 1024 ** 2 },
			categories: {
				new: { count: 1, bytes: 1024 },
				open: { count: 1, bytes: 25 * 1024 ** 2 },
				done: { count: 0, bytes: 0 },
				discarded: { count: 1, bytes: 2048, next_empty: '2026-10-31' },
				trash: { count: 1, bytes: 5 * 1024 ** 2 },
				other: { count: 0, bytes: 0 }
			},
			copies: { count: 1, bytes: 1024 },
			largest: [
				{
					item: 'item00000000001',
					title: 'Rechnung',
					channel: 'mail',
					bytes: 25 * 1024 ** 2,
					category: 'open',
					ticket: { id: 'ticket000000001', key: 'HAUS-12', status: 'open', trashed: false },
					copy_of: ''
				},
				{ item: 'broken', bytes: 'x', category: 'open' }
			]
		},
		backups: {
			local: {
				count: 2,
				bytes: 100 * 1024 ** 2,
				oldest: '2026-09-30T03:00:00.000Z',
				newest: '2026-10-01T03:00:00.000Z'
			},
			pocketbase: {
				count: 1,
				bytes: 40 * 1024 ** 2,
				oldest: '2026-08-01T00:00:00.000Z',
				newest: '2026-08-01T00:00:00.000Z'
			},
			other: none,
			target: 'unreachable',
			safety: none
		},
		logs: { count: 3, bytes: 4096 },
		program: {
			files: { count: 3, bytes: 210 * 1024 ** 2 },
			leftovers: { count: 1, bytes: 95 * 1024 ** 2 },
			web: { bytes: 12 * 1024 ** 2, complete: true, builds: 10 }
		},
		disk: { level: 'warning', text: '412 MB frei auf C:\\' },
		actions: {
			leftovers: {
				programs: { count: 1, bytes: 95 * 1024 ** 2 },
				safety: none,
				pocketbase: { count: 1, bytes: 40 * 1024 ** 2 }
			},
			discarded: { count: 1, bytes: 2048 }
		},
		...overrides
	};
}
