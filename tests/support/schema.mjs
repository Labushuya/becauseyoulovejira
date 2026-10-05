// Expected E1 schema after all migrations (E1 plan, section 3, packages 3 and 5) plus helpers to
// read the actual schema from the Superuser API or directly from a data folder.

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';

const STATUSES = ['backlog', 'open', 'in_progress', 'waiting', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/**
 * Ways into the inbox and values of tickets.source (ADR-0014), written out literally; "api" and
 * "whatsapp-web" since the own inbox (ADR-0038, migration 1790202400), "github" since the GitHub
 * channel (ADR-0050, migration 1790203200), "folder" since the folder channel (ADR-0051, migration
 * 1790203300).
 */
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
	'notion',
	'api',
	'whatsapp-web',
	'github',
	'folder'
];
/**
 * Kinds of entries; "change", "pull_request" and "release" since the GitHub channel (ADR-0050,
 * migration 1790203200), "file" since the folder channel (ADR-0051, migration 1790203300).
 */
export const INBOX_KINDS = [
	'todo',
	'task',
	'project_task',
	'mail',
	'event',
	'message',
	'link',
	'change',
	'pull_request',
	'release',
	'file'
];
/** Kinds of connections; "github" since migration 1790203200 (ADR-0050), "folder" since 1790203300 (ADR-0051). */
export const CONNECTION_TYPES = ['calendar', 'telegram', 'notion', 'mail', 'github', 'folder'];
/**
 * The palette of projects and tickets (ADR-0052, migration 1790203400), written out literally; the
 * same keys as PROJECT_COLORS of web/src/lib/domain/colors.ts (tests/integration/colors.test.mjs).
 */
export const PROJECT_COLORS = ['violett', 'indigo', 'blau', 'himmel', 'tuerkis', 'gruen', 'oliv', 'senf', 'braun', 'grau'];
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
		fields: {
			name: text({ required: true, max: 100 }),
			...timestamps(),
			// Retention of the trash of the household (E7-3, ADR-0059 §6, migration 1790204100).
			trash_retention: select(['7', '30', '90', 'never'], false)
		},
		indexes: []
	},
	household_members: {
		fields: {
			user: relation('users', { required: true, cascadeDelete: true }),
			household: relation('households', { required: true, cascadeDelete: true }),
			role: select(['owner', 'member'], true),
			...timestamps(),
			// Rights of a member (ADR-0058, migration 1790203800); the owner has every one by the role.
			rights: {
				type: 'select',
				required: false,
				values: ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'],
				maxSelect: 6
			}
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_household_members_household_user ON household_members (household, user)'
		]
	},
	// Invitation codes of a household (ADR-0058, migration 1790203800); only the hash, hidden.
	household_invites: {
		fields: {
			household: relation('households', { required: true, cascadeDelete: true }),
			code_hash: text({ required: true, max: 64, pattern: '^[0-9a-f]{64}$', hidden: true }),
			created_by: relation('users'),
			expires_at: { type: 'date', required: true },
			used_at: date(),
			used_by: relation('users'),
			revoked_at: date(),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_household_invites_code_hash ON household_invites (code_hash)',
			'CREATE INDEX idx_household_invites_household ON household_invites (household)'
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
			parent: relation('projects'),
			// Color of the palette (ADR-0052, migration 1790203400), empty for none.
			color: select(PROJECT_COLORS, false)
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
			each_occurrence: bool(),
			// "Status beim Anlegen" (plan WV, migration 1790202500): every status but done.
			initial_status: select(['backlog', 'open', 'in_progress', 'waiting'], false),
			// Sub-tasks of the template (plan WV-3, migration 1790202700), checked by the hook.
			template_subtasks: { type: 'json', required: false, maxSize: 40000 },
			// Color of the next tickets (ADR-0052, migration 1790203400), empty for "wie Projekt".
			color: select(PROJECT_COLORS, false),
			// Charm of the next tickets (ADR-0062, migration 1790204400), empty for none; the hook
			// checks the key against its catalog.
			charm: text({ max: 40 })
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
			occurrence: date(),
			// Trash (ADR-0037, migration 1790202300); only the server writes them.
			deleted_at: date(),
			deleted_by: relation('users'),
			trash: { type: 'json', required: false, maxSize: 20000 },
			// The pinned comment (ADR-0044, migration 1790202600): one per ticket.
			pinned_comment: relation('comments'),
			// Own color (ADR-0052, migration 1790203400), empty for "wie Projekt".
			color: select(PROJECT_COLORS, false),
			// Charm (ADR-0062, migration 1790204400), empty for none; the hook checks the key.
			charm: text({ max: 40 })
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
			// instance per rule; since 1790202300 without the tickets in the trash, ADR-0037).
			"CREATE UNIQUE INDEX idx_tickets_open_occurrence ON tickets (recurrence, occurrence) WHERE recurrence != '' AND status != 'done' AND deleted_at = ''",
			'CREATE INDEX idx_tickets_deleted_at ON tickets (deleted_at)',
			'CREATE INDEX idx_tickets_pinned_comment ON tickets (pinned_comment)'
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
			// The project the entry got from its way (ADR-0049, migration 1790203100).
			target_project: relation('projects'),
			// Status of a watched source, written by the server only (ADR-0050, migration 1790203200).
			watch: { type: 'json', required: false, maxSize: 2000 },
			scope: text({ required: true }),
			...ownership(),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_inbox_items_scope_fingerprint ON inbox_items (scope, fingerprint)',
			'CREATE INDEX idx_inbox_items_owner_state ON inbox_items (owner, state)',
			'CREATE INDEX idx_inbox_items_ticket ON inbox_items (ticket)',
			'CREATE INDEX idx_inbox_items_target_project ON inbox_items (target_project)'
		]
	},
	// Fingerprints of entries that moved out of an area (E7-4b, ADR-0061 addendum E7-4b, migration
	// 1790204300): the area keeps them for its duplicate check.
	inbox_moved_fingerprints: {
		fields: {
			scope: text({ required: true, max: 100 }),
			fingerprint: text({ required: true, max: 100 }),
			created: created()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_inbox_moved_fingerprints_scope_fingerprint ON inbox_moved_fingerprints (scope, fingerprint)'
		]
	},
	connections: {
		fields: {
			type: select(CONNECTION_TYPES, true),
			label: text({ required: true, max: 100 }),
			enabled: bool(),
			// Optional since the folder channel, which has no access data (ADR-0051, migration 1790203300).
			secret_env: text({ max: 64, pattern: '^BYL_[A-Z0-9_]{1,60}$' }),
			settings: { type: 'json', required: false, maxSize: 20000 },
			cursor: text({ max: 200 }),
			last_run_at: date(),
			last_ok_at: date(),
			last_error: text({ max: 1000 }),
			last_hint: text({ max: 1000 }),
			running_since: date(),
			scope: text({ required: true }),
			scan: { type: 'json', required: false, maxSize: 2000 },
			// Target project of the entries of the connection (ADR-0049, migration 1790203100).
			target_project: relation('projects'),
			// What the GitHub channel knows of its repositories, hidden (ADR-0050, migration 1790203200);
			// up to 8 MB since the folder channel keeps its folders there (ADR-0051, migration 1790203300).
			watch: { type: 'json', required: false, hidden: true, maxSize: 8388608 },
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
	// Pinned tickets (ADR-0064, migration 1790204500): one row per account and ticket.
	ticket_pins: {
		fields: {
			user: relation('users', { required: true, cascadeDelete: true }),
			ticket: relation('tickets', { required: true, cascadeDelete: true }),
			created: created()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_ticket_pins_user_ticket ON ticket_pins (user, ticket)',
			'CREATE INDEX idx_ticket_pins_ticket ON ticket_pins (ticket)'
		]
	},
	ticket_counters: {
		fields: {
			key: text({ required: true }),
			value: number({ min: 0, max: null })
		},
		indexes: ['CREATE UNIQUE INDEX idx_ticket_counters_key ON ticket_counters (key)']
	},
	// Access keys of the own inbox (ADR-0038, migration 1790202400); the hash is hidden.
	inbox_keys: {
		fields: {
			name: text({ required: true, max: 60 }),
			token_hash: text({ required: true, max: 64, pattern: '^[0-9a-f]{64}$', hidden: true }),
			token_hint: text({ required: true, max: 20 }),
			last_used_at: date(),
			owner: relation('users', { required: true, cascadeDelete: true }),
			...timestamps()
		},
		indexes: [
			'CREATE UNIQUE INDEX idx_inbox_keys_token_hash ON inbox_keys (token_hash)',
			'CREATE INDEX idx_inbox_keys_owner ON inbox_keys (owner)'
		]
	},
	// Failed sign-ins for the page "Sicherheit" (ADR-0055 §8, migration 1790203600); never a password.
	login_failures: {
		fields: {
			area: select(['app', 'admin'], true),
			identity: text({ max: 200 }),
			known: bool(),
			source: select(['app', 'web', 'program'], true),
			host: text({ max: 201 }),
			ip: text({ max: 64 }),
			created: created()
		},
		indexes: ['CREATE INDEX idx_login_failures_created ON login_failures (created)']
	}
};

export const RULE_NAMES = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];

// API rules of package 4 (CLAUDE.md section 5, OF-2, OF-3, OF-5), written out literally so the
// test does not reuse the construction logic of the migration. Since 1790203900 (ADR-0058 §5) the
// owner branch holds for private records only; household records go through the membership.
const AUTH = '@request.auth.id != ""';
const OWNED =
	`${AUTH} && ((owner = @request.auth.id && household = "") || (household != "" && ` +
	'@collection.household_members.household ?= household && ' +
	'@collection.household_members.user ?= @request.auth.id))';
const VIA_TICKET_BRANCH =
	'((ticket.owner = @request.auth.id && ticket.household = "") || (ticket.household != "" && ' +
	'@collection.household_members.household ?= ticket.household && ' +
	'@collection.household_members.user ?= @request.auth.id))';
const VIA_TICKET = `${AUTH} && ${VIA_TICKET_BRANCH}`;
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
// The trash is hidden from every rule that reads tickets (ADR-0037, migration 1790202300).
const LIVE = ' && deleted_at = ""';
const LIVE_TICKET = ' && ticket.deleted_at = ""';
const LIVE_ITEM = ' && (ticket = "" || ticket.deleted_at = "")';
const LIVE_DEPENDENCY = ' && blocker.deleted_at = "" && blocked.deleted_at = ""';
const READ_ONLY = { createRule: null, updateRule: null, deleteRule: null };
const HOUSEHOLD_MEMBER =
	`${AUTH} && @collection.household_members.household ?= id && ` +
	'@collection.household_members.user ?= @request.auth.id';

// Members of the own households see each other (ADR-0056 §4, migration 1790203700; before only the
// own rows, 'user = @request.auth.id').
const SAME_HOUSEHOLD = `${AUTH} && household.household_members_via_household.user ?= @request.auth.id`;

export const EXPECTED_RULES = {
	households: { listRule: HOUSEHOLD_MEMBER, viewRule: HOUSEHOLD_MEMBER, ...READ_ONLY },
	household_members: { listRule: SAME_HOUSEHOLD, viewRule: SAME_HOUSEHOLD, ...READ_ONLY },
	projects: OWNED_RULES,
	tags: OWNED_RULES,
	recurrence_rules: OWNED_RULES,
	tickets: {
		...OWNED_RULES,
		listRule: OWNED + LIVE,
		viewRule: OWNED + LIVE,
		updateRule: OWNED_RULES.updateRule + LIVE,
		deleteRule: OWNED + LIVE
	},
	// No inbox item is deletable through the API (ADR-0014, addendum of 2026-10-01, 1790202800;
	// before it only the source of a ticket, ADR-0031 section 3, 1790201800); the hook refuses
	// superusers as well.
	inbox_items: {
		...OWNED_RULES,
		listRule: OWNED + LIVE_ITEM,
		viewRule: OWNED + LIVE_ITEM,
		updateRule: OWNED_RULES.updateRule + LIVE_ITEM,
		deleteRule: null
	},
	connections: OWNED_RULES,
	comments: {
		listRule: VIA_TICKET + LIVE_TICKET,
		viewRule: VIA_TICKET + LIVE_TICKET,
		createRule: `${VIA_TICKET} && @request.body.author = @request.auth.id${LIVE_TICKET}`,
		updateRule:
			`${VIA_TICKET} && author = @request.auth.id && ` +
			`@request.body.author:changed = false && @request.body.ticket:changed = false${LIVE_TICKET}`,
		deleteRule: `${VIA_TICKET} && author = @request.auth.id${LIVE_TICKET}`
	},
	ticket_history: { listRule: VIA_TICKET + LIVE_TICKET, viewRule: VIA_TICKET + LIVE_TICKET, ...READ_ONLY },
	dependencies: { listRule: OWNED + LIVE_DEPENDENCY, viewRule: OWNED + LIVE_DEPENDENCY, ...READ_ONLY },
	ticket_counters: { listRule: null, viewRule: null, ...READ_ONLY },
	ticket_reads: {
		listRule: `${AUTH} && user = @request.auth.id${LIVE_TICKET}`,
		viewRule: `${AUTH} && user = @request.auth.id${LIVE_TICKET}`,
		createRule:
			`${AUTH} && @request.body.user = @request.auth.id && ` +
			'((ticket.owner = @request.auth.id && ticket.household = "") || (ticket.household != "" && ' +
			'@collection.household_members.household ?= ticket.household && ' +
			`@collection.household_members.user ?= @request.auth.id))${LIVE_TICKET}`,
		updateRule: null,
		deleteRule: `${AUTH} && user = @request.auth.id`
	},
	// Only the own pins on tickets the account sees, without the trash (ADR-0064); never changed.
	ticket_pins: {
		listRule: `${AUTH} && user = @request.auth.id && ${VIA_TICKET_BRANCH}${LIVE_TICKET}`,
		viewRule: `${AUTH} && user = @request.auth.id && ${VIA_TICKET_BRANCH}${LIVE_TICKET}`,
		createRule: `${AUTH} && @request.body.user = @request.auth.id && ${VIA_TICKET_BRANCH}${LIVE_TICKET}`,
		updateRule: null,
		deleteRule: `${AUTH} && user = @request.auth.id`
	},
	// Only the routes of the household read and write the codes (ADR-0058).
	household_invites: { listRule: null, viewRule: null, ...READ_ONLY },
	// Only the owner lists and revokes; keys are created by the route, never changed.
	inbox_keys: {
		listRule: `${AUTH} && owner = @request.auth.id`,
		viewRule: `${AUTH} && owner = @request.auth.id`,
		createRule: null,
		updateRule: null,
		deleteRule: `${AUTH} && owner = @request.auth.id`
	},
	// Only the hooks write and read the failed sign-ins (ADR-0055 §8).
	login_failures: { listRule: null, viewRule: null, ...READ_ONLY },
	// Only the hooks read and write the fingerprints of moved entries (E7-4b).
	inbox_moved_fingerprints: { listRule: null, viewRule: null, ...READ_ONLY }
};

// The own record, every record for the administrator of the app and the accounts of the own
// households (ADR-0056 §4, migration 1790203700); writing stays with the own record.
const READABLE_USERS =
	`${AUTH} && (id = @request.auth.id || @request.auth.instance_admin = true || ` +
	'household_members_via_user.household.household_members_via_household.user ?= @request.auth.id)';

export const EXPECTED_USERS_RULES = {
	listRule: READABLE_USERS,
	viewRule: READABLE_USERS,
	createRule: null,
	updateRule: 'id = @request.auth.id',
	deleteRule: null
};

/** PocketBase 0.40.4 defaults, restored by the down migrations. */
export const DEFAULT_USERS_RULES = {
	listRule: 'id = @request.auth.id',
	viewRule: 'id = @request.auth.id',
	createRule: '',
	updateRule: 'id = @request.auth.id',
	deleteRule: 'id = @request.auth.id'
};
/**
 * The automatic backup of PocketBase after all migrations: off since the backups of the app took
 * over (ADR-0046, 1790203000), with the number kept of ADR-0003 (1790200800) that no longer matters.
 */
export const EXPECTED_BACKUPS = { cron: '', cronMaxKeep: 12 };
/** The schedule of ADR-0003 (1790200800), until 1790203000 switches it off. */
export const ADR_0003_BACKUPS = { cron: '0 */4 * * *', cronMaxKeep: 12 };
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
