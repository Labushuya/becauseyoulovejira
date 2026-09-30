// "Ticket duplizieren" (ADR-0045): the SPA names the codes of the route with the same texts as the
// hook, and sends and reads what the route expects.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	DUPLICATE_MESSAGES,
	duplicateRequestBody,
	toDuplicateOutcome
} from '../../web/src/lib/domain/duplicate.ts';

const rules = loadHookLib('duplicate-rules.js');

const take = {
	description: true,
	priority: false,
	tags: true,
	due: false,
	parent: false,
	subtasks: true,
	comments: false
};

describe('texts of the codes of "Ticket duplizieren" (web/src/lib/domain/duplicate.ts)', () => {
	it('equal those of duplicate-rules.js', () => {
		expect({ ...DUPLICATE_MESSAGES }).toEqual({ ...rules.MESSAGES });
	});
});

describe('request and answer', () => {
	it('sends a body the hook reads as the same choice', () => {
		const body = duplicateRequestBody({ title: 'Kopie', status: 'waiting', project: null, take, source: 'copy' });
		expect(rules.parseRequest(body).options).toEqual({ title: 'Kopie', status: 'waiting', project: '', source: 'copy', ...take });
		expect(duplicateRequestBody({ title: 'K', status: 'open', project: 'p1', take, source: 'none' }).project).toBe('p1');
	});

	it('reads the answer of the route and refuses anything else', () => {
		const answer = {
			id: 'd1',
			key: 'HAUS-13',
			title: 'Kopie',
			original: { id: 'o1', key: 'HAUS-12' },
			subtasks: [{ id: 's1', key: 'HAUS-14' }],
			comments: 2,
			source: ''
		};
		expect(toDuplicateOutcome(answer)).toEqual({ ...answer, source: null });
		expect(toDuplicateOutcome({ ...answer, source: 'i1' })?.source).toBe('i1');
		for (const broken of [null, [], { ...answer, id: '' }, { ...answer, original: null }, { ...answer, subtasks: [{}] }, { ...answer, comments: '2' }]) {
			expect(toDuplicateOutcome(broken)).toBeNull();
		}
	});
});
