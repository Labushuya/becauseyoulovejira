// The length limits of the frontend match the schema (E2 plan, package 6: maxlength per field).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	COMMENT_MAX_LENGTH,
	DESCRIPTION_MAX_LENGTH,
	TITLE_MAX_LENGTH
} from '../../web/src/lib/domain/ticket.ts';

const MIGRATIONS = new URL('../../app/pb_migrations/', import.meta.url);

function maxOf(file, field) {
	const source = readFileSync(new URL(file, MIGRATIONS), 'utf8');
	const match = new RegExp(`name: '${field}'[^}]*\\bmax: (\\d+)`).exec(source);
	if (!match) throw new Error(`No max for ${field} in ${file}`);
	return Number(match[1]);
}

describe('length limits (web/src/lib/domain/ticket.ts)', () => {
	it('match the tickets and comments collections', () => {
		expect(TITLE_MAX_LENGTH).toBe(maxOf('1790200500_create_tickets.js', 'title'));
		expect(DESCRIPTION_MAX_LENGTH).toBe(maxOf('1790200500_create_tickets.js', 'description'));
		expect(COMMENT_MAX_LENGTH).toBe(maxOf('1790200600_create_ticket_children.js', 'body'));
	});
});
