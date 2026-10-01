// Dependencies of a ticket in the trash (ADR-0047, ADR-0037 addendum): when a group is blocked,
// which options the decision help offers for each dependency (only the ways our rules allow), the
// collective ways and the check of a list of decisions before anything is written.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('trash-dependencies.js');
const trashRules = loadHookLib('trash-rules.js');

const ticket = (id, status = 'open', extra = {}) => ({ id, key: `HAUS-${id}`, title: `Ticket ${id}`, status, blocks: true, ...extra });
const source = (id, ticketId, primary = false) => ({ id, ticket: ticketId, title: `Quelle ${id}`, channel: 'mail', scope: 'u:a', primary });

describe('dependency rule', () => {
	it('is free when every ticket of the group is done and no source hangs on it', () => {
		const deps = rules.dependenciesOf({ tickets: [ticket('1', 'done'), ticket('2', 'done')], sources: [] });
		expect(deps).toEqual([]);
		expect(rules.isBlocked(deps)).toBe(false);
		expect(rules.dependenciesOf({})).toEqual([]);
	});

	it('blocks for the ticket itself, every open sub-task and every bound source, in a fixed order', () => {
		const deps = rules.dependenciesOf({
			tickets: [ticket('1'), ticket('2', 'done'), ticket('3', 'waiting')],
			sources: [source('s2', '3'), source('s1', '1'), source('s0', '1', true)]
		});
		expect(rules.isBlocked(deps)).toBe(true);
		expect(deps.map((dep) => (dep.kind === 'ticket' ? `t:${dep.ticket}` : `s:${dep.item}`))).toEqual(['t:1', 't:3', 's:s0', 's:s1', 's:s2']);
		expect(deps[0]).toMatchObject({ kind: 'ticket', key: 'HAUS-1', status: 'open', subtask: false, open_blocking: 1 });
		expect(deps[1]).toMatchObject({ kind: 'ticket', key: 'HAUS-3', status: 'waiting', subtask: true, open_blocking: 0 });
		expect(deps[2]).toMatchObject({ kind: 'source', item: 's0', ticket: '1', key: 'HAUS-1', primary: true, scope: 'u:a' });
		expect(deps[4]).toMatchObject({ kind: 'source', item: 's2', key: 'HAUS-3', primary: false });
		expect(rules.countsOf(deps)).toEqual({ total: 5, tickets: 2, sources: 3 });
	});

	it('blocks a done ticket for a sub-task that is not done (every status but done counts)', () => {
		for (const status of ['backlog', 'open', 'in_progress', 'waiting']) {
			const deps = rules.dependenciesOf({ tickets: [ticket('1', 'done'), ticket('2', status)], sources: [] });
			expect(deps.map((dep) => dep.ticket), status).toEqual(['2']);
		}
	});
});

describe('options of the decision help (only what our rules allow)', () => {
	it('offers done, restore and, for a sub-task, detach', () => {
		const [root, child] = rules.dependenciesOf({ tickets: [ticket('1', 'open'), ticket('2', 'open', { blocks: false })], sources: [] });
		expect(root.options).toEqual(['complete', 'restore']);
		expect(child.options).toEqual(['complete', 'restore', 'detach']);
	});

	it('completes the first ticket only together with open blocking sub-tasks (ADR-0033)', () => {
		const [root] = rules.dependenciesOf({ tickets: [ticket('1'), ticket('2')], sources: [] });
		expect(root.options).toEqual(['complete_children', 'restore']);
	});

	it('never moves the main source to another ticket (ADR-0031)', () => {
		const deps = rules.dependenciesOf({ tickets: [ticket('1', 'done')], sources: [source('a', '1', true), source('b', '1')] });
		expect(deps.map((dep) => dep.options)).toEqual([
			['inbox', 'discard'],
			['inbox', 'discard', 'move']
		]);
	});
});

describe('collective ways', () => {
	const deps = rules.dependenciesOf({
		tickets: [ticket('1'), ticket('2'), ticket('3', 'done')],
		sources: [source('a', '1', true), source('b', '2')]
	});

	it('marks the sub-tasks done before the first ticket', () => {
		expect(rules.collectiveActions(deps, 'complete')).toEqual([
			{ action: 'complete', ticket: '2' },
			{ action: 'complete', ticket: '1' }
		]);
	});

	it('gives back or discards every source', () => {
		expect(rules.collectiveActions(deps, 'inbox')).toEqual([
			{ action: 'inbox', item: 'a' },
			{ action: 'inbox', item: 'b' }
		]);
		expect(rules.collectiveActions(deps, 'discard').map((action) => action.action)).toEqual(['discard', 'discard']);
		expect(rules.collectiveActions(deps, 'other')).toEqual([]);
		for (const kind of ['complete', 'inbox', 'discard']) {
			expect(rules.actionsViolation(rules.collectiveActions(deps, kind), deps, ['1', '2', '3']), kind).toBeNull();
		}
	});
});

describe('checking a list of decisions', () => {
	const deps = rules.dependenciesOf({ tickets: [ticket('1'), ticket('2', 'done')], sources: [source('a', '1', true), source('b', '1')] });
	const check = (actions) => rules.actionsViolation(actions, deps, ['1', '2']);

	it('takes decisions on open dependencies', () => {
		expect(check([{ action: 'complete', ticket: '1' }, { action: 'move', item: 'b', target: 'x' }, { action: 'discard', item: 'a' }])).toBeNull();
	});

	it('refuses an empty or too long list and unknown decisions', () => {
		for (const actions of [undefined, null, 'complete', {}, []]) {
			expect(check(actions), String(actions)).toEqual({ index: -1, code: 'validation_trash_resolve_empty' });
		}
		const many = Array.from({ length: rules.MAX_ACTIONS + 1 }, () => ({ action: 'complete', ticket: '1' }));
		expect(check(many).code).toBe('validation_trash_resolve_empty');
		expect(check([{ action: 'delete', item: 'a' }])).toEqual({ index: 0, code: 'validation_trash_resolve_action' });
		expect(check([null])).toEqual({ index: 0, code: 'validation_trash_resolve_action' });
	});

	it('refuses what is no open dependency of this group, and the same one twice', () => {
		expect(check([{ action: 'complete', ticket: '2' }])).toEqual({ index: 0, code: 'validation_trash_resolve_target' });
		expect(check([{ action: 'complete', ticket: 'x' }])).toEqual({ index: 0, code: 'validation_trash_resolve_target' });
		expect(check([{ action: 'inbox', item: 'x' }]).code).toBe('validation_trash_resolve_target');
		expect(check([{ action: 'inbox', ticket: '1' }]).code).toBe('validation_trash_resolve_target');
		expect(check([{ action: 'inbox', item: 'b' }, { action: 'discard', item: 'b' }])).toEqual({ index: 1, code: 'validation_trash_resolve_target' });
	});

	it('moves only a source that is not the main source, onto a ticket outside the group', () => {
		expect(check([{ action: 'move', item: 'a', target: 'x' }])).toEqual({ index: 0, code: 'validation_trash_resolve_primary' });
		expect(check([{ action: 'move', item: 'b' }]).code).toBe('validation_trash_resolve_target');
		expect(check([{ action: 'move', item: 'b', target: '2' }]).code).toBe('validation_trash_resolve_target');
	});

	it('words every code of the rule in trash-rules', () => {
		for (const code of [
			'validation_trash_blocked',
			'validation_trash_resolve_empty',
			'validation_trash_resolve_action',
			'validation_trash_resolve_target',
			'validation_trash_resolve_primary'
		]) {
			expect(trashRules.MESSAGES[code], code).toMatch(/\S/);
		}
	});
});
