// Expected E1 schema after all migrations (E1 plan, section 3, packages 3 and 5) plus helpers to
// read the actual schema from the Superuser API or directly from a data folder.

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';

const STATUSES = ['backlog', 'open', 'in_progress', 'waiting', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/** Ways into the inbox and values of tickets.source (ADR-0014), written out literally. */
export const CHANNELS = [
	'manual',
	'quick',
	'clipboard',
	'link',
	'eml',
	'mail',
	'ics',
	'calendar',
	'whatsapp',
	'telegram',
	'notion'
];
export const INBOX_KINDS = ['todo', 'task', 'project_task', 'mail', 'event', 'message', 'link'];
export const INBOX_STATES = ['new', 'converted', 'discarded'];

const text = (options = {}) => ({ type: 'text', required: false, max: 0, pattern: '', ...options });
const number = (options = {}) => ({ type: 'number', required: false, onlyInt: true, ...options });
const bool = () => ({ type: 'bool', required: false });
const date = () => ({ type: 'date', required: false });
const select = (values, required) => ({ type: 'select', required, values, maxSelect: 1 });
const relation = (collection, { required = false, cascadeDelete = false, maxSelect = 1 } = {}) => ({
	type: 'relation',
	collection,
	required,
	cascadeDelete,
	maxSelect
});
const created = () => ({ type: 'autodate', onCreate: true, onUpdate: false });
const updated = () => ({ type: 'autodate', onCreate: true, onUpdate: true });
const timestamps = () => ({ created: created(), updated: updated() });
const ownership = () => ({
	owner: relation('users', { required: true }),
	household: relation('households')
});

/** Collections created by app/pb_migrations; API rules are listed in EXPECTED_RULES. */
export const EXPECTED_COLLECTIONS = {
	households: {
		fields: { name: text({ required: true, max: 100 }), ...timestamps() },
		indexes: []
	},
	household_members: {
		fields: {
			user: relation('users', { required: true, cascadeDelete: true }),
			household: relation('households', { required: true, cascadeDelete: true }),
			role: select(['owner', 'member'], true),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_household_members_household_user ON household_members (household, user)'
		]
	},
	projects: {
		fields: {
			name: text({ required: true, max: 100 }),
			code: text({ required: true, max: 6, pattern: '^[A-Z]{2,6}$' }),
			archived: bool(),
			...ownership(),
			scope: text({ required: true }),
			...timestamps(),
			// Sub projects (ADR-0034, migration 1790202100): one level, checked by the hook.
			parent: relation('projects')
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_projects_scope_code ON projects (scope, code)',
			'CREATE INDEX idx_projects_owner ON projects (owner)',
			'CREATE INDEX idx_projects_parent ON projects (parent)'
		]
	},
	tags: {
		fields: {
			name: text({ required: true, max: 50 }),
			...ownership(),
			scope: text({ required: true }),
			...timestamps()
		},
		indexes: ['CREATE UNIQUE INDEX idx_tags_scope_name ON tags (scope, name COLLATE NOCASE)']
	},
	recurrence_rules: {
		fields: {
			title: text({ required: true, max: 200 }),
			description: text({ max: 100000 }),
			project: relation('projects'),
			tags: relation('tags', { maxSelect: 100 }),
			priority: select(PRIORITIES, false),
			mode: select(['calendar', 'after_completion'], true),
			next_due: date(),
			last_generated_at: date(),
			active: bool(),
			...ownership(),
			...timestamps(),
			// E5 (ADR-0021 section 1, migration 1790201600).
			freq: select(['daily', 'weekly', 'monthly', 'yearly'], false),
			interval: number({ min: 1, max: 365 }),
			weekdays: { type: 'select', required: false, values: WEEKDAYS, maxSelect: 7 },
			month_day: number({ min: -1, max: 31 }),
			anchor: date(),
			lead_days: number({ min: 0, max: 30 }),
			scope: text({ required: true }),
			last_hint: text({ max: 500 }),
			// "Jeden Termin einzeln anlegen" (plan OR-5, migration 1790202200).
			each_occurrence: bool()
		},
		indexes: [
			'CREATE INDEX idx_recurrence_rules_owner ON recurrence_rules (owner)',
			'CREATE INDEX idx_recurrence_rules_active_next_due ON recurrence_rules (active, next_due)',
			'CREATE INDEX idx_recurrence_rules_scope ON recurrence_rules (scope)'
		]
	},
	tickets: {
		fields: {
			number: number({ required: true, min: 1, max: null }),
			key: text({ required: true }),
			title: text({ required: true, max: 200 }),
			description: text({ max: 100000 }),
			status: select(STATUSES, true),
			priority: select(PRIORITIES, true),
			due: date(),
			project: relation('projects'),
			tags: relation('tags', { maxSelect: 100 }),
			completed_at: date(),
			blocks_parent: bool(),
			recurrence: relation('recurrence_rules'),
			scope: text({ required: true }),
			...ownership(),
			...timestamps(),
			parent: relation('tickets'),
			source: select(CHANNELS, false),
			source_item: relation('inbox_items'),
			// Date of the series with "Jeden Termin einzeln anlegen" (plan OR-5, migration 1790202200).
			occurrence: date()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_tickets_scope_key ON tickets (scope, key)',
			'CREATE INDEX idx_tickets_owner ON tickets (owner)',
			'CREATE INDEX idx_tickets_project ON tickets (project)',
			'CREATE INDEX idx_tickets_status ON tickets (status)',
			'CREATE INDEX idx_tickets_due ON tickets (due)',
			'CREATE INDEX idx_tickets_parent ON tickets (parent)',
			'CREATE INDEX idx_tickets_source_item ON tickets (source_item)',
			// At most one open instance per rule and date of the series (ADR-0022 section 1 and addendum
			// 2; migration 1790201610, since 1790202200 with occurrence, which is empty for one open
			// instance per rule).
			"CREATE UNIQUE INDEX idx_tickets_open_occurrence ON tickets (recurrence, occurrence) WHERE recurrence != '' AND status != 'done'"
		]
	},
	inbox_items: {
		fields: {
			channel: select(CHANNELS, true),
			kind: select(INBOX_KINDS, true),
			title: text({ required: true, max: 200 }),
			body: text({ max: 100000 }),
			source_url: text({ max: 2000 }),
			source_ref: text({ max: 500 }),
			source_date: date(),
			source_meta: { type: 'json', required: false, maxSize: 20000 },
			// 25 MB since the migration 1790202000 (ADR-0031, addendum D), 10 MB before.
			original: { type: 'file', required: false, maxSelect: 1, maxSize: 26214400, protected: true },
			fingerprint: text({ required: true, max: 100 }),
			state: select(INBOX_STATES, true),
			ticket: relation('tickets'),
			handled_at: date(),
			connection: relation('connections'),
			scope: text({ required: true }),
			...ownership(),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_inbox_items_scope_fingerprint ON inbox_items (scope, fingerprint)',
			'CREATE INDEX idx_inbox_items_owner_state ON inbox_items (owner, state)',
			'CREATE INDEX idx_inbox_items_ticket ON inbox_items (ticket)'
		]
	},
	connections: {
		fields: {
			type: select(['calendar', 'telegram', 'notion', 'mail'], true),
			label: text({ required: true, max: 100 }),
			enabled: bool(),
			secret_env: text({ required: true, max: 64, pattern: '^BYL_[A-Z0-9_]{1,60}$' }),
			settings: { type: 'json', required: false, maxSize: 20000 },
			cursor: text({ max: 200 }),
			last_run_at: date(),
			last_ok_at: date(),
			last_error: text({ max: 1000 }),
			last_hint: text({ max: 1000 }),
			running_since: date(),
			scope: text({ required: true }),
			scan: { type: 'json', required: false, maxSize: 2000 },
			...ownership(),
			...timestamps()
		},
		indexes: [
			'CREATE INDEX idx_connections_owner ON connections (owner)',
			'CREATE INDEX idx_connections_type_enabled ON connections (type, enabled)'
		]
	},
	comments: {
		fields: {
			ticket: relation('tickets', { required: true, cascadeDelete: true }),
			author: relation('users', { required: true }),
			body: text({ required: true, max: 20000 }),
			...timestamps()
		},
		indexes: ['CREATE INDEX idx_comments_ticket_created ON comments (ticket, created)']
	},
	ticket_history: {
		fields: {
			ticket: relation('tickets', { required: true, cascadeDelete: true }),
			field: text({ required: true, max: 50 }),
			old_value: text({ max: 100000 }),
			new_value: text({ max: 100000 }),
			user: relation('users'),
			created: created()
		},
		indexes: [
			'CREATE INDEX idx_ticket_history_ticket_created ON ticket_history (ticket, created)'
		]
	},
	dependencies: {
		fields: {
			blocker: relation('tickets', { required: true, cascadeDelete: true }),
			blocked: relation('tickets', { required: true, cascadeDelete: true }),
			...ownership(),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_dependencies_blocker_blocked ON dependencies (blocker, blocked)'
		]
	},
	ticket_reads: {
		fields: {
			user: relation('users', { required: true, cascadeDelete: true }),
			ticket: relation('tickets', { required: true, cascadeDelete: true }),
			seen_at: created()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_ticket_reads_user_ticket ON ticket_reads (user, ticket)',
			'CREATE INDEX idx_ticket_reads_ticket ON ticket_reads (ticket)'
		]
	},
	ticket_counters: {
		fields: {
			key: text({ required: true }),
			value: number({ min: 0, max: null })
		},
		indexes: ['CREATE UNIQUE INDEX idx_ticket_counters_key ON ticket_counters (key)']
	}
};

export const RULE_NAMES = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];

// API rules of package 4 (CLAUDE.md section 5, OF-2, OF-3, OF-5), written out literally so the
// test does not reuse the construction logic of the migration.
const AUTH = '@request.auth.id != ""';
const OWNED =
	`${AUTH} && (owner = @request.auth.id || (household != "" && ` +
	'@collection.household_members.household ?= household && ' +
	'@collection.household_members.user ?= @request.auth.id))';
const VIA_TICKET =
	`${AUTH} && (ticket.owner = @request.auth.id || (ticket.household != "" && ` +
	'@collection.household_members.household ?= ticket.household && ' +
	'@collection.household_members.user ?= @request.auth.id))';
const BODY_HOUSEHOLD_ALLOWED =
	'(@request.body.household:isset = false || @request.body.household = "" || (' +
	'@collection.household_members:target.household ?= @request.body.household && ' +
	'@collection.household_members:target.user ?= @request.auth.id))';
const OWNED_RULES = {
	listRule: OWNED,
	viewRule: OWNED,
	createRule: `${AUTH} && @request.body.owner = @request.auth.id && ${BODY_HOUSEHOLD_ALLOWED}`,
	updateRule: `${OWNED} && @request.body.owner:changed = false && ${BODY_HOUSEHOLD_ALLOWED}`,
	deleteRule: OWNED
};
const READ_ONLY = { createRule: null, updateRule: null, deleteRule: null };
const HOUSEHOLD_MEMBER =
	`${AUTH} && @collection.household_members.household ?= id && ` +
	'@collection.household_members.user ?= @request.auth.id';

export const EXPECTED_RULES = {
	households: { listRule: HOUSEHOLD_MEMBER, viewRule: HOUSEHOLD_MEMBER, ...READ_ONLY },
	household_members: {
		listRule: 'user = @request.auth.id',
		viewRule: 'user = @request.auth.id',
		...READ_ONLY
	},
	projects: OWNED_RULES,
	tags: OWNED_RULES,
	recurrence_rules: OWNED_RULES,
	tickets: OWNED_RULES,
	// The source of a ticket is not deletable (ADR-0031 section 3, 1790201800).
	inbox_items: { ...OWNED_RULES, deleteRule: `${OWNED} && ticket = ""` },
	connections: OWNED_RULES,
	comments: {
		listRule: VIA_TICKET,
		viewRule: VIA_TICKET,
		createRule: `${VIA_TICKET} && @request.body.author = @request.auth.id`,
		updateRule:
			`${VIA_TICKET} && author = @request.auth.id && ` +
			'@request.body.author:changed = false && @request.body.ticket:changed = false',
		deleteRule: `${VIA_TICKET} && author = @request.auth.id`
	},
	ticket_history: { listRule: VIA_TICKET, viewRule: VIA_TICKET, ...READ_ONLY },
	dependencies: { listRule: OWNED, viewRule: OWNED, ...READ_ONLY },
	ticket_counters: { listRule: null, viewRule: null, ...READ_ONLY },
	ticket_reads: {
		listRule: `${AUTH} && user = @request.auth.id`,
		viewRule: `${AUTH} && user = @request.auth.id`,
		createRule:
			`${AUTH} && @request.body.user = @request.auth.id && ` +
			'(ticket.owner = @request.auth.id || (ticket.household != "" && ' +
			'@collection.household_members.household ?= ticket.household && ' +
			'@collection.household_members.user ?= @request.auth.id))',
		updateRule: null,
		deleteRule: `${AUTH} && user = @request.auth.id`
	}
};

export const EXPECTED_USERS_RULES = {
	listRule: 'id = @request.auth.id',
	viewRule: 'id = @request.auth.id',
	createRule: null,
	updateRule: 'id = @request.auth.id',
	deleteRule: null
};

/** PocketBase 0.40.4 defaults, restored by the down migrations. */
export const DEFAULT_USERS_RULES = { ...EXPECTED_USERS_RULES, createRule: '', deleteRule: 'id = @request.auth.id' };
export const EXPECTED_BACKUPS = { cron: '0 */4 * * *', cronMaxKeep: 12 };
export const DEFAULT_BACKUPS = { cron: '', cronMaxKeep: 3 };

/** Removes quoting and whitespace differences (addIndex() quotes names with backticks). */
export function normalizeIndex(sql) {
	return sql.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Asserts that `collections` (API or database view, same JSON shape) contain the E1 schema.
 * @param {Array<Record<string, any>>} collections
 */
export function assertSchema(collections) {
	const byName = new Map(collections.map((collection) => [collection.name, collection]));
	const nameById = new Map(collections.map((collection) => [collection.id, collection.name]));

	for (const [name, spec] of Object.entries(EXPECTED_COLLECTIONS)) {
		const collection = byName.get(name);
		expect(collection, `collection ${name}`).toBeDefined();
		expect(collection.type, `${name}.type`).toBe('base');
		for (const rule of RULE_NAMES) {
			expect(collection[rule], `${name}.${rule}`).toBe(EXPECTED_RULES[name][rule]);
		}

		const fields = collection.fields.filter((field) => !field.system);
		expect(fields.map((field) => field.name).sort(), `${name} fields`).toEqual(
			Object.keys(spec.fields).sort()
		);
		expect(collection.fields.find((field) => field.name === 'id')?.primaryKey).toBe(true);
		for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
			const field = fields.find((candidate) => candidate.name === fieldName);
			const { collection: target, ...properties } = fieldSpec;
			expect(field, `${name}.${fieldName}`).toMatchObject(properties);
			if (target !== undefined) {
				expect(nameById.get(field.collectionId), `${name}.${fieldName} target`).toBe(target);
			}
		}

		expect(collection.indexes.map(normalizeIndex).sort(), `${name} indexes`).toEqual(
			spec.indexes.map(normalizeIndex).sort()
		);
	}

	const users = byName.get('users');
	expect(users?.type).toBe('auth');
	for (const rule of RULE_NAMES) {
		expect(users[rule], `users.${rule}`).toBe(EXPECTED_USERS_RULES[rule]);
	}
	expect(users.passwordAuth.enabled).toBe(true);
	expect(users.oauth2.enabled).toBe(false);
	expect(users.otp.enabled).toBe(false);
}

/**
 * Reads collections, settings and row counts straight from a data folder (no server needed).
 * @param {string} dataDir
 */
export function readDataDir(dataDir) {
	const db = new DatabaseSync(join(dataDir, 'data.db'), { readOnly: true });
	try {
		const collections = db
			.prepare('SELECT * FROM _collections ORDER BY name')
			.all()
			.map((row) => ({
				...row,
				system: Boolean(row.system),
				fields: JSON.parse(row.fields),
				indexes: JSON.parse(row.indexes),
				options: undefined,
				...JSON.parse(row.options || '{}')
			}));
		const settingsRow = db.prepare("SELECT value FROM _params WHERE id = 'settings'").get();
		const settings = JSON.parse(new TextDecoder().decode(settingsRow.value));
		const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
		return { collections, settings, userCount: count('users'), superuserCount: count('_superusers') };
	} finally {
		db.close();
	}
}
