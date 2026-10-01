// The trash speaks with one voice (ADR-0037): the texts of the validation codes and the values of
// the retention are the same in the hook (app/pb_hooks/lib/trash-rules.js) and in the SPA
// (web/src/lib/domain/trash.ts), and the data layer reads every code the hook sends. The rule of
// the dependencies (ADR-0047, lib/trash-dependencies.js) and its SPA mirror
// (domain/trash-dependencies.ts) give the same options, counts and collective ways.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { TRASH_CODES, TRASH_MESSAGES, TRASH_RETENTIONS, parseRetention } from '../../web/src/lib/domain/trash.ts';
import { collectiveActions, countsOf, optionsOf } from '../../web/src/lib/domain/trash-dependencies.ts';
import { toDependency } from '../../web/src/lib/data/trash.ts';

const rules = loadHookLib('trash-rules.js');
const dependencyRules = loadHookLib('trash-dependencies.js');

describe('trash in hook and SPA', () => {
	it('has the same texts for every code', () => {
		expect(TRASH_MESSAGES).toEqual(rules.MESSAGES);
		for (const code of Object.values(TRASH_CODES)) {
			expect(rules.MESSAGES[code], code).toBeDefined();
		}
	});

	it('knows the same retention values with the same default', () => {
		expect([...TRASH_RETENTIONS]).toEqual(rules.RETENTION_VALUES);
		for (const value of ['', 'x', null]) {
			expect(rules.retentionDays(value)).toBe(Number(parseRetention(value)));
		}
		for (const value of TRASH_RETENTIONS) {
			const days = rules.retentionDays(value);
			expect(days === null ? 'never' : String(days)).toBe(value);
		}
	});
});

/** Groups of every shape: statuses, blocking sub-tasks and main or other sources. */
function groups() {
	const statuses = ['open', 'done', 'waiting'];
	const list = [];
	for (const root of statuses) {
		for (const child of [null, ...statuses]) {
			for (const blocks of [true, false]) {
				for (const sources of [[], [true], [false, true], [false, false]]) {
					const tickets = [{ id: 'r', key: 'HAUS-1', title: 'Dach', status: root, blocks: true }];
					if (child !== null) tickets.push({ id: 'c', key: 'HAUS-2', title: 'Ziegel', status: child, blocks });
					list.push({
						tickets,
						sources: sources.map((primary, index) => ({
							id: `s${index}`,
							ticket: index === 1 && child !== null ? 'c' : 'r',
							title: `Quelle ${index}`,
							channel: 'mail',
							scope: 'u:a',
							primary
						}))
					});
				}
			}
		}
	}
	return list;
}

describe('dependencies in hook and SPA (ADR-0047)', () => {
	it('offer the same options, counts and collective ways, read back by the data layer', () => {
		for (const group of groups()) {
			const hook = dependencyRules.dependenciesOf(group);
			const spa = hook.map((entry) => toDependency(entry));
			expect(spa.every((entry) => entry !== null), JSON.stringify(group)).toBe(true);
			for (let index = 0; index < hook.length; index++) {
				expect(spa[index].options, JSON.stringify(hook[index])).toEqual(hook[index].options);
				expect([...optionsOf(spa[index])]).toEqual(dependencyRules.optionsOf(hook[index]));
			}
			expect(countsOf(spa)).toEqual(dependencyRules.countsOf(hook));
			for (const kind of ['complete', 'inbox', 'discard']) {
				expect(collectiveActions(spa, kind), kind).toEqual(dependencyRules.collectiveActions(hook, kind));
			}
		}
	});
});
