// An answer of GET /api/byl/security (ADR-0055 §8) for the tests of the page "Sicherheit": the
// limiter at "Normal", the own addresses only, the home network off, encrypted backups, two access
// data, two keys, the built extension and two groups of failed sign-ins.

export function securityAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		level: 'normal',
		cors: { restricted: true },
		hosts: {
			own: ['127.0.0.1:8090', 'localhost:8090'],
			active: [],
			configured: [],
			editable: true,
			max: 10
		},
		lan: { active: false, hosts: [], editable: true },
		admin: { ips: ['127.0.0.1', '::1'], loopbackOnly: true },
		session: { days: 5, seconds: 432000, choices: [1, 5, 14, 30], standard: 5 },
		backup: {
			available: true,
			target: true,
			reachable: true,
			sealed: 3,
			newest: '2026-10-03T08:00:00.000Z'
		},
		secrets: [
			{ name: 'BYL_INGEST_TOKEN', set: true },
			{ name: 'BYL_WEBDE_PASSWORD', set: true }
		],
		keys: { count: 2, lastUsedAt: '2026-10-02 18:30:00.000Z' },
		extension: { built: true, version: '0.1.0' },
		logins: {
			days: 30,
			total: 4,
			lastDay: 3,
			groups: [
				{
					area: 'app',
					identity: 'anna@example.com',
					known: true,
					source: 'app',
					host: '127.0.0.1:8090',
					count: 3,
					first: '2026-10-03 09:00:00.000Z',
					last: '2026-10-03 09:05:00.000Z'
				},
				{
					area: 'admin',
					identity: 'admin@example.com',
					known: false,
					source: 'web',
					host: 'localhost:8090',
					count: 1,
					first: '2026-09-20 10:00:00.000Z',
					last: '2026-09-20 10:00:00.000Z'
				}
			]
		},
		...overrides
	};
}
