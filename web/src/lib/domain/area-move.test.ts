// Moving between the areas and dissolving a household (E7-4, ADR-0060): when the menus offer it, the
// answers of the routes read strictly, the lines of the dialog, its choices and their checks, the body
// of the request and the history entry of a moved ticket.

import { describe, expect, it } from 'vitest';
import {
	areaMoveHistoryText,
	choiceErrors,
	countLines,
	dissolveCountLines,
	initialChoices,
	moveBody,
	moveDirection,
	moveProblemText,
	nameConfirmed,
	noteLines,
	parseDissolvePreview,
	parseMovePreview,
	type MovePreview
} from './area-move';
import type { Membership } from './household';

const ME = 'user00000000001';
const OTHER = 'user00000000002';
const owner: Membership = { id: 'm1', role: 'owner', rights: [] };
const member: Membership = { id: 'm2', role: 'member', rights: [] };
const mover: Membership = { id: 'm3', role: 'member', rights: ['move_out'] };

/** An answer of the route as the server writes it. */
function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		preview: true,
		kind: 'ticket',
		to: 'household',
		scope: 'h:house0000000001',
		from_name: 'Privat',
		to_name: 'Haus Beispiel',
		counts: {
			tickets: 3,
			subtasks: 2,
			projects: 0,
			rules: 0,
			items: 1,
			comments: 4,
			dependencies: 0
		},
		conflicts: {
			project: {
				projects: [{ id: 'proj00000000001', code: 'PRIV', name: 'Privates' }],
				tickets: 3,
				rules: 0,
				targets: [{ id: 'proj00000000002', code: 'HAUS', name: 'Haus' }]
			},
			tags: { reused: ['einkauf'], created: ['garten'] },
			dependencies: [
				{
					ticket: { id: 'tick00000000001', key: 'PRIV-1', title: 'Eins' },
					other: { id: 'tick00000000009', key: 'PRIV-9', title: 'Neun' }
				}
			],
			parents: [{ id: 'tick00000000002', key: 'PRIV-2', parent: 'PRIV-7' }],
			project_parents: [],
			codes: [{ id: 'proj00000000001', code: 'PRIV', name: 'Privates', suggestion: 'PRIVH' }],
			series: [{ id: 'tick00000000003', key: 'PRIV-3' }],
			rule_tickets: 0,
			rules_project: [],
			items: { connection: 1, target: 0, duplicate: 2 },
			targets: 0
		},
		needs: { project: true, dependencies: true, codes: ['proj00000000001'] },
		...overrides
	};
}

function preview(overrides: Record<string, unknown> = {}): MovePreview {
	const parsed = parseMovePreview(answer(overrides));
	if (parsed === null) throw new Error('fixture does not parse');
	return parsed;
}

describe('when the menus offer moving (ADR-0060 §4)', () => {
	it('offers nothing without a household or a session', () => {
		expect(moveDirection({ area: 'private', membership: null, userId: ME, owner: ME })).toBeNull();
		expect(
			moveDirection({ area: 'private', membership: owner, userId: null, owner: ME })
		).toBeNull();
	});

	it('offers own private records into the household', () => {
		expect(moveDirection({ area: 'private', membership: member, userId: ME, owner: ME })).toBe(
			'household'
		);
		expect(
			moveDirection({ area: 'private', membership: member, userId: ME, owner: OTHER })
		).toBeNull();
	});

	it('offers records of the household into the private area to the creator, "move_out" and the owner', () => {
		const from = { area: 'household' as const, userId: ME };
		expect(moveDirection({ ...from, membership: member, owner: ME })).toBe('private');
		expect(moveDirection({ ...from, membership: member, owner: OTHER })).toBeNull();
		expect(moveDirection({ ...from, membership: mover, owner: OTHER })).toBe('private');
		expect(moveDirection({ ...from, membership: owner, owner: OTHER })).toBe('private');
	});
});

describe('the answer of the route', () => {
	it('reads every part of a preview', () => {
		const parsed = preview();
		expect(parsed).toMatchObject({
			preview: true,
			kind: 'ticket',
			to: 'household',
			fromName: 'Privat',
			toName: 'Haus Beispiel',
			needs: { project: true, dependencies: true, codes: ['proj00000000001'] },
			moved: null
		});
		expect(parsed.conflicts.project?.targets).toEqual([
			{ id: 'proj00000000002', code: 'HAUS', name: 'Haus' }
		]);
		expect(parsed.conflicts.projectParents).toEqual([]);
		expect(parsed.conflicts.items).toEqual({ connection: 1, target: 0, duplicate: 2 });
	});

	it('reads the result of a move with the new keys', () => {
		const parsed = preview({
			preview: false,
			moved: {
				tickets: [{ id: 'tick00000000001', key: 'HAUS-4', previous: 'PRIV-1' }],
				projects: [],
				rules: [],
				items: ['item00000000001']
			}
		});
		expect(parsed.moved?.tickets).toEqual([
			{ id: 'tick00000000001', key: 'HAUS-4', previous: 'PRIV-1' }
		]);
		expect(parsed.moved?.items).toEqual(['item00000000001']);
	});

	it('refuses anything else', () => {
		expect(parseMovePreview(null)).toBeNull();
		expect(parseMovePreview(answer({ kind: 'epic' }))).toBeNull();
		expect(parseMovePreview(answer({ to: 'nowhere' }))).toBeNull();
		expect(parseMovePreview(answer({ counts: [] }))).toBeNull();
		expect(
			parseMovePreview(answer({ conflicts: { ...(answer().conflicts as object), parents: 'x' } }))
		).toBeNull();
	});

	it('names every refusal of the server in German', () => {
		expect(moveProblemText('right')).toMatch(/^Dafür fehlt dir das Recht/);
		expect(moveProblemText('linked')).toMatch(/gehört zu einem Ticket/);
		expect(moveProblemText('unbekannt')).toBe('Der Server hat die Anfrage abgelehnt.');
	});
});

describe('what the dialog shows', () => {
	it('counts what moves, one line per kind, with the sub-tasks', () => {
		expect(countLines(preview())).toEqual([
			'3 Tickets (davon 2 Unteraufgaben)',
			'1 Eintrag im Eingang',
			'4 Kommentare'
		]);
		const single = preview({
			counts: {
				tickets: 1,
				subtasks: 0,
				projects: 1,
				rules: 1,
				items: 0,
				comments: 1,
				dependencies: 1
			}
		});
		expect(countLines(single)).toEqual([
			'1 Ticket',
			'1 Projekt',
			'1 Wiederholung',
			'1 Kommentar',
			'1 Abhängigkeit'
		]);
	});

	it('says what else changes without a choice', () => {
		expect(noteLines(preview())).toEqual([
			'Tags im Ziel übernommen: einkauf',
			'Tags im Ziel neu angelegt: garten',
			'PRIV-2 wird im Ziel ein Hauptticket (PRIV-7 bleibt zurück).',
			'PRIV-3 verlässt seine Wiederholung.',
			'1 Eintrag verliert den Bezug zur Verbindung; Verbindungen bleiben privat.',
			'2 Einträge gibt es im Ziel schon; beide bleiben.'
		]);
	});
});

describe('the choices of the dialog', () => {
	it('starts without a project and a decision, the taken codes with the suggestion', () => {
		expect(initialChoices(preview())).toEqual({
			project: null,
			dependencies: null,
			codes: { proj00000000001: 'PRIVH' }
		});
	});

	it('asks for the project, the dependencies and valid new codes', () => {
		const shown = preview();
		const start = initialChoices(shown);
		expect(Object.keys(choiceErrors(shown, start, true)).sort()).toEqual([
			'dependencies',
			'project'
		]);
		const chosen = { ...start, project: '', dependencies: 'take' as const };
		expect(choiceErrors(shown, chosen, true)).toEqual({});
		for (const code of ['', 'P', 'TASK', 'PRIV', 'ZU-LANG', 'ÄBC']) {
			const errors = choiceErrors(shown, { ...chosen, codes: { proj00000000001: code } }, true);
			expect(Object.keys(errors), code).toEqual(['code:proj00000000001']);
		}
		// Lower case and spaces are fine: the server stores capitals.
		expect(
			choiceErrors(shown, { ...chosen, codes: { proj00000000001: ' pr ivx ' } }, true)
		).toEqual({});
	});

	it('refuses the same new code for two moved projects', () => {
		const shown = preview({
			conflicts: {
				...(answer().conflicts as object),
				codes: [
					{ id: 'proj00000000001', code: 'AB', name: 'A', suggestion: 'ABH' },
					{ id: 'proj00000000003', code: 'CD', name: 'C', suggestion: 'CDH' }
				]
			}
		});
		const errors = choiceErrors(
			shown,
			{
				project: '',
				dependencies: 'release',
				codes: { proj00000000001: 'XY', proj00000000003: 'xy' }
			},
			true
		);
		expect(Object.keys(errors)).toEqual(['code:proj00000000003']);
	});

	it('builds the body of the route with only what was chosen', () => {
		const request = { kind: 'ticket' as const, ids: ['tick00000000001'], to: 'household' as const };
		expect(moveBody(request, { project: null, dependencies: null, codes: {} }, true)).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			preview: true
		});
		expect(
			moveBody(
				request,
				{ project: '', dependencies: 'take', codes: { proj00000000001: ' privh ' } },
				false
			)
		).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			project: '',
			dependencies: 'take',
			codes: { proj00000000001: 'PRIVH' }
		});
	});
});

describe('the history entry of a moved ticket', () => {
	it('names the direction and the key before', () => {
		expect(areaMoveHistoryText('PRIV-12', JSON.stringify({ to: 'household', key: 'HAUS-3' }))).toBe(
			'In den Haushalt verschoben (vorher PRIV-12)'
		);
		expect(areaMoveHistoryText('HAUS-3', JSON.stringify({ to: 'private', key: 'TASK-9' }))).toBe(
			'Ins Private verschoben (vorher HAUS-3)'
		);
		expect(
			areaMoveHistoryText('HAUS-3', JSON.stringify({ to: 'private', key: 'X-1', dissolved: true }))
		).toBe('Aus dem aufgelösten Haushalt ins Private übernommen (vorher HAUS-3)');
	});

	it('adds the project, a parent left behind and the series', () => {
		const value = JSON.stringify({
			to: 'household',
			key: 'TASK-1',
			project: { from: 'Haus', to: '' },
			parent: 'PRIV-7',
			series: true
		});
		expect(areaMoveHistoryText('PRIV-8', value)).toBe(
			'In den Haushalt verschoben (vorher PRIV-8); Projekt: Haus → –; übergeordnetes Ticket PRIV-7 blieb zurück; aus der Wiederholung gelöst'
		);
		expect(areaMoveHistoryText('', 'kein JSON')).toBe('Ins Private verschoben');
	});
});

describe('dissolving a household', () => {
	const dissolve = {
		preview: true,
		mode: 'adopt',
		household: { id: 'house0000000001', name: 'Haus Beispiel' },
		members: [
			{ name: 'Anna Beispiel', role: 'owner', self: true },
			{ name: 'Bert Beispiel', role: 'member', self: false }
		],
		counts: {
			tickets: 2,
			trash: 1,
			projects: 1,
			rules: 0,
			items: 0,
			tags: 3,
			connections: 0,
			comments: 1
		},
		codes: [{ id: 'proj00000000001', code: 'HAUS', name: 'Haus', suggestion: 'HAUSH' }]
	};

	it('reads the preview strictly', () => {
		expect(parseDissolvePreview(dissolve)).toMatchObject({
			mode: 'adopt',
			household: { name: 'Haus Beispiel' },
			members: [
				{ name: 'Anna Beispiel', role: 'owner', self: true },
				{ name: 'Bert Beispiel', role: 'member', self: false }
			]
		});
		expect(parseDissolvePreview({ ...dissolve, mode: 'both' })).toBeNull();
		expect(parseDissolvePreview({ ...dissolve, household: { id: '' } })).toBeNull();
	});

	it('counts what the household holds', () => {
		expect(dissolveCountLines(dissolve.counts)).toEqual([
			'2 Tickets',
			'1 Ticket im Papierkorb',
			'1 Projekt',
			'3 Tags',
			'1 Kommentar'
		]);
	});

	it('confirms deleting only with the name, white space at the ends aside', () => {
		expect(nameConfirmed('  Haus Beispiel ', 'Haus Beispiel')).toBe(true);
		expect(nameConfirmed('haus beispiel', 'Haus Beispiel')).toBe(false);
		expect(nameConfirmed('', '')).toBe(false);
	});
});
