// Expected E1 schema after all migrations (E1 plan, section 3 and package 3) plus helpers to
// read the actual schema from the Superuser API or directly from a data folder.

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';

const STATUSES = ['backlog', 'open', 'in_progress', 'waiting', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

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

/** Collections created by app/pb_migrations; every API rule is null in package 3. */
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
			scope: text(),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_projects_scope_code ON projects (scope, code)',
			'CREATE INDEX idx_projects_owner ON projects (owner)'
		]
	},
	tags: {
		fields: {
			name: text({ required: true, max: 50 }),
			...ownership(),
			scope: text(),
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
			...timestamps()
		},
		indexes: [
			'CREATE INDEX idx_recurrence_rules_owner ON recurrence_rules (owner)',
			'CREATE INDEX idx_recurrence_rules_active_next_due ON recurrence_rules (active, next_due)'
		]
	},
	tickets: {
		fields: {
			number: number({ min: 1, max: null }),
			key: text(),
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
			scope: text(),
			...ownership(),
			...timestamps(),
			parent: relation('tickets')
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_tickets_scope_key ON tickets (scope, key)',
			'CREATE INDEX idx_tickets_owner ON tickets (owner)',
			'CREATE INDEX idx_tickets_project ON tickets (project)',
			'CREATE INDEX idx_tickets_status ON tickets (status)',
			'CREATE INDEX idx_tickets_due ON tickets (due)',
			'CREATE INDEX idx_tickets_parent ON tickets (parent)'
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
	ticket_counters: {
		fields: {
			key: text({ required: true }),
			value: number({ min: 0, max: null })
		},
		indexes: ['CREATE UNIQUE INDEX idx_ticket_counters_key ON ticket_counters (key)']
	}
};

export const RULE_NAMES = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];

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
			expect(collection[rule], `${name}.${rule}`).toBeNull();
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
