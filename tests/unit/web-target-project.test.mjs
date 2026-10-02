// The target project of the web app (web/src/lib/domain/target-project.ts) against the hook module
// (app/pb_hooks/lib/target-project-rules.js, ADR-0049): the same cards and channels, the same texts
// of the codes, the same reading of the stored targets of a user, and the same set of the filter
// "Zielprojekt" as the server expression `target_project = p || target_project.parent = p`.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CARD_CHANNELS,
	TARGET_CARDS,
	TARGET_GONE_KEY,
	TARGET_MESSAGES,
	inboxTargetsOf,
	matchesTarget
} from '../../web/src/lib/domain/target-project.ts';

const rules = loadHookLib('target-project-rules.js');

const HAUS = 'haus00000000001';
const GARTEN = 'garten000000001';
const ARBEIT = 'arbeit000000001';

describe('web target project against the hooks', () => {
	it('knows the same cards with the same channels', () => {
		expect([...TARGET_CARDS]).toEqual(rules.CARDS);
		for (const card of TARGET_CARDS) {
			expect([...CARD_CHANNELS[card]], card).toEqual(rules.CARD_CHANNELS[card]);
		}
		expect(TARGET_GONE_KEY).toBe(rules.GONE_KEY);
	});

	it('words the codes of the hooks the same', () => {
		expect(TARGET_MESSAGES).toEqual(rules.MESSAGES);
	});

	it('reads the stored targets of a user the same', () => {
		for (const value of [
			null,
			{},
			{ files: HAUS },
			{ api: HAUS, 'whatsapp-web': ARBEIT, files: '' },
			{ files: 'Haus', mail: HAUS },
			[HAUS],
			'files'
		]) {
			expect(inboxTargetsOf(value), JSON.stringify(value)).toEqual(rules.targetsOf(value));
		}
	});

	it('takes a project with its sub projects in, like the filter of the server', () => {
		const projects = [
			{ id: HAUS, name: 'Haus', code: 'HAUS', archived: false, parentId: null },
			{ id: GARTEN, name: 'Garten', code: 'GART', archived: false, parentId: HAUS },
			{ id: ARBEIT, name: 'Arbeit', code: 'ARB', archived: true, parentId: null }
		];
		const parentOf = new Map(projects.map((project) => [project.id, project.parentId]));
		// The server expression: the target is the project, or its parent is the project.
		const server = (target, filter) =>
			filter === 'ohne' ? target === null : target === filter || (target !== null && parentOf.get(target) === filter);
		for (const target of [null, HAUS, GARTEN, ARBEIT]) {
			for (const filter of [null, 'ohne', HAUS, GARTEN, ARBEIT]) {
				const expected = filter === null ? true : server(target, filter);
				expect(matchesTarget({ targetProjectId: target }, filter, projects), `${target} in ${filter}`).toBe(
					expected
				);
			}
		}
	});
});
