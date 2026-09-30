// Pure rules of "Ticket duplizieren" (ADR-0045): the request of the route, the fields taken over,
// the history value, the note of copied comments and the details of a copied source.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('duplicate-rules.js');

const valid = { title: ' Kopie ', status: 'open' };

describe('parseRequest', () => {
	it('reads title, status, project, source and the flags', () => {
		const { options } = rules.parseRequest({
			...valid,
			project: 'p1',
			source: 'copy',
			description: true,
			priority: 'true',
			tags: false,
			due: true,
			parent: true,
			subtasks: true,
			comments: true
		});
		expect(options).toEqual({
			title: 'Kopie',
			status: 'open',
			project: 'p1',
			source: 'copy',
			description: true,
			priority: true,
			tags: false,
			due: true,
			parent: true,
			subtasks: true,
			comments: true
		});
	});

	it('takes over nothing and copies no source unless asked', () => {
		const { options } = rules.parseRequest(valid);
		expect(options).toMatchObject({ project: '', source: 'none', description: false, subtasks: false, comments: false });
		expect(rules.parseRequest({ ...valid, source: null }).options.source).toBe('none');
	});

	it('requires a title of 1 to 200 characters', () => {
		for (const title of [undefined, '', '   ', 'x'.repeat(201)]) {
			expect(rules.parseRequest({ ...valid, title })).toEqual({ field: 'title', code: 'validation_duplicate_title' });
		}
		expect(rules.parseRequest({ ...valid, title: 'x'.repeat(200) }).options.title).toHaveLength(200);
	});

	it('requires the status without a default and never allows "done"', () => {
		for (const status of [undefined, null, '']) {
			expect(rules.parseRequest({ ...valid, status })).toEqual({
				field: 'status',
				code: 'validation_duplicate_status_required'
			});
		}
		for (const status of ['done', 'erledigt', 'OPEN']) {
			expect(rules.parseRequest({ ...valid, status })).toEqual({ field: 'status', code: 'validation_duplicate_status' });
		}
		for (const status of ['backlog', 'open', 'in_progress', 'waiting']) {
			expect(rules.parseRequest({ ...valid, status }).options.status).toBe(status);
		}
	});

	it('refuses an unknown choice of the source', () => {
		expect(rules.parseRequest({ ...valid, source: 'link' })).toEqual({ field: 'source', code: 'validation_duplicate_source' });
	});

	it('reads anything but an object as empty', () => {
		for (const body of [null, undefined, 'x', 3]) {
			expect(rules.parseRequest(body)).toEqual({ field: 'title', code: 'validation_duplicate_title' });
		}
	});

	it('has a text for every code', () => {
		for (const code of [
			'validation_duplicate_title',
			'validation_duplicate_status_required',
			'validation_duplicate_status',
			'validation_duplicate_source',
			'validation_duplicate_source_missing',
			'validation_duplicate_source_file'
		]) {
			expect(rules.MESSAGES[code], code).toMatch(/\S/);
		}
	});
});

describe('takenValues', () => {
	const ticket = { description: 'Text', priority: 'high', tags: ['t1', 't2'], due: '2026-10-05 00:00:00.000Z' };

	it('takes the chosen fields and leaves the others to the defaults of a new ticket', () => {
		expect(rules.takenValues(ticket, { description: true, priority: true, tags: true, due: true })).toEqual(ticket);
		expect(rules.takenValues(ticket, { description: false, priority: false, tags: false, due: false })).toEqual({
			description: '',
			priority: '',
			tags: [],
			due: ''
		});
	});

	it('copies the list of tags', () => {
		const taken = rules.takenValues(ticket, { tags: true });
		taken.tags.push('t3');
		expect(ticket.tags).toEqual(['t1', 't2']);
	});
});

describe('history value', () => {
	it('names direction, ticket and key', () => {
		expect(JSON.parse(rules.historyValue('from', 'a1', 'HAUS-12'))).toEqual({ direction: 'from', ticket: 'a1', key: 'HAUS-12' });
		expect(JSON.parse(rules.historyValue('to', 'b2', 'HAUS-13'))).toEqual({ direction: 'to', ticket: 'b2', key: 'HAUS-13' });
		expect(rules.HISTORY_FIELD).toBe('duplicate');
	});
});

describe('copiedCommentBody', () => {
	it('puts the note with a link to the original first', () => {
		expect(rules.copiedCommentBody('Hallo', 'HAUS-12', 'abcdefghijklmno', 20000)).toBe(
			'_Kopiert aus [HAUS-12](/tickets/abcdefghijklmno)._\n\nHallo'
		);
	});

	it('keeps the whole text at the limit of the field: the note loses its link first', () => {
		const linked = '_Kopiert aus [HAUS-12](/tickets/abcdefghijklmno)._\n\n';
		const plain = '_Kopiert aus HAUS-12._\n\n';
		const fits = 'x'.repeat(100 - linked.length);
		expect(rules.copiedCommentBody(fits, 'HAUS-12', 'abcdefghijklmno', 100)).toBe(linked + fits);
		const longer = 'x'.repeat(100 - plain.length);
		expect(rules.copiedCommentBody(longer, 'HAUS-12', 'abcdefghijklmno', 100)).toBe(plain + longer);
	});

	it('cuts only a text that does not fit even then, and never goes over the limit', () => {
		const body = rules.copiedCommentBody('y'.repeat(20000), 'HAUS-12', 'abcdefghijklmno', 20000);
		expect(body).toHaveLength(20000);
		expect(body.startsWith('_Kopiert aus HAUS-12._\n\n')).toBe(true);
		expect(body.endsWith('y…')).toBe(true);
	});
});

describe('copyMeta', () => {
	it('keeps the details of the source and adds where the copy came from', () => {
		const meta = { from: 'anna@example.com', page: { size: 12 }, ticket_deleted: { key: 'X-1' }, copy_of: { key: 'old' } };
		expect(rules.copyMeta(meta, { item: 'i1', ticket: 't1', key: 'HAUS-12', at: '2026-10-01 10:00:00.000Z' })).toEqual({
			from: 'anna@example.com',
			page: { size: 12 },
			copy_of: { item: 'i1', ticket: 't1', key: 'HAUS-12', at: '2026-10-01 10:00:00.000Z' }
		});
		expect(rules.copyMeta(null, { item: 'i1', ticket: 't1', key: 'K-1', at: '' })).toEqual({
			copy_of: { item: 'i1', ticket: 't1', key: 'K-1', at: '' }
		});
	});
});
