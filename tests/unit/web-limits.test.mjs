// The length limits of the frontend match the schema (E2 plan, package 6: maxlength per field;
// E3 plan, package 3: project and tag names).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_NAME_MAX_LENGTH } from '../../web/src/lib/domain/project.ts';
import { TAG_NAME_MAX_LENGTH } from '../../web/src/lib/domain/tag.ts';
import {
	COMMENT_MAX_LENGTH,
	DESCRIPTION_MAX_LENGTH,
	TITLE_MAX_LENGTH
} from '../../web/src/lib/domain/ticket.ts';

const MIGRATIONS = new URL('../../app/pb_migrations/', import.meta.url);

/**
 * `max` of a field in a migration. `collection` limits the search to the part after
 * `name: '<collection>'`, for files that create several collections with equal field names.
 */
function maxOf(file, field, collection) {
	let source = readFileSync(new URL(file, MIGRATIONS), 'utf8');
	if (collection !== undefined) {
		const start = source.indexOf(`name: '${collection}'`);
		if (start === -1) throw new Error(`No collection ${collection} in ${file}`);
		source = source.slice(start);
	}
	const match = new RegExp(`name: '${field}'[^}]*\\bmax: (\\d+)`).exec(source);
	if (!match) throw new Error(`No max for ${field} in ${file}`);
	return Number(match[1]);
}

describe('length limits (web/src/lib/domain)', () => {
	it('match the tickets and comments collections', () => {
		expect(TITLE_MAX_LENGTH).toBe(maxOf('1790200500_create_tickets.js', 'title'));
		expect(DESCRIPTION_MAX_LENGTH).toBe(maxOf('1790200500_create_tickets.js', 'description'));
		expect(COMMENT_MAX_LENGTH).toBe(maxOf('1790200600_create_ticket_children.js', 'body'));
	});

	it('match the projects and tags collections', () => {
		const file = '1790200300_create_projects_tags.js';
		expect(PROJECT_NAME_MAX_LENGTH).toBe(maxOf(file, 'name', 'projects'));
		expect(TAG_NAME_MAX_LENGTH).toBe(maxOf(file, 'name', 'tags'));
		expect(PROJECT_NAME_MAX_LENGTH).not.toBe(TAG_NAME_MAX_LENGTH);
	});
});
