// The project code rule of the frontend (web/src/lib/domain/project.ts) matches the hook module
// app/pb_hooks/lib/ticket-key.js and the schema pattern of projects.code (E3 plan, T-11).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	PROJECT_CODE_MAX_LENGTH,
	PROJECT_CODE_PATTERN,
	RESERVED_CODE,
	isValidProjectCode
} from '../../web/src/lib/domain/project.ts';

const ticketKey = loadHookLib('ticket-key.js');
const migration = readFileSync(
	new URL('../../app/pb_migrations/1790200300_create_projects_tags.js', import.meta.url),
	'utf8'
);

/** Every string of up to `length` characters over `alphabet`. */
function* words(alphabet, length) {
	yield '';
	if (length === 0) return;
	for (const shorter of words(alphabet, length - 1)) {
		if (shorter.length !== length - 1) continue;
		for (const letter of alphabet) yield shorter + letter;
	}
}

describe('project code (web/src/lib/domain/project.ts)', () => {
	it('uses the pattern and reserved code of ticket-key.js', () => {
		expect(PROJECT_CODE_PATTERN.source).toBe(ticketKey.PROJECT_CODE_PATTERN.source);
		expect(PROJECT_CODE_PATTERN.flags).toBe(ticketKey.PROJECT_CODE_PATTERN.flags);
		expect(RESERVED_CODE).toBe(ticketKey.TASK);
	});

	it('uses the pattern and length of the schema', () => {
		const field = /name: 'code'[^}]*\bmax: (\d+), pattern: '([^']+)'/.exec(migration);
		expect(field).not.toBeNull();
		expect(PROJECT_CODE_MAX_LENGTH).toBe(Number(field[1]));
		expect(PROJECT_CODE_PATTERN.source).toBe(field[2]);
	});

	it('decides like isValidProjectCode of ticket-key.js', () => {
		const samples = [
			...words(['A', 'T', 'a', '1', 'Ä', '-'], 3),
			'TASK',
			'TASKS',
			'TAS',
			'ABCDEF',
			'ABCDEFG',
			'HAUS',
			' HAUS',
			'HAUS\n',
			'haus'
		];
		for (const code of samples) {
			expect(isValidProjectCode(code), JSON.stringify(code)).toBe(ticketKey.isValidProjectCode(code));
		}
	});
});
