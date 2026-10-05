// Moving between the areas and dissolving a household (E7-4, ADR-0061): when the menus offer it, the
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
	offersSeries,
	parseDissolvePreview,
	parseMovePreview,
	ticketSourceLine,
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

describe('when the menus offer moving (ADR-0061 §4)', () => {
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

	it('names the targets of repositories and folders that are cleared (E7-4b)', () => {
		const conflicts = answer().conflicts as Record<string, unknown>;
		// A server before E7-4b does not name them: none.
		expect(preview().conflicts.unitTargets).toBe(0);
		const one = preview({ conflicts: { ...conflicts, unit_targets: 1 } });
		expect(one.conflicts.unitTargets).toBe(1);
		expect(noteLines(one).at(-1)).toBe(
			'1 Zielprojekt von Repositorys oder Ordnern in den Kanälen wird geleert.'
		);
		const two = preview({ conflicts: { ...conflicts, targets: 1, unit_targets: 2 } });
		expect(noteLines(two).slice(-2)).toEqual([
			'1 Zielprojekt von Einträgen, Verbindungen oder Karten des Eingangs wird geleert.',
			'2 Zielprojekte von Repositorys oder Ordnern in den Kanälen werden geleert.'
		]);
	});
});

describe('the choices of the dialog', () => {
	it('starts without a project and a decision, the taken codes with the suggestion', () => {
		expect(initialChoices(preview())).toEqual({
			project: null,
			dependencies: null,
			ticketSources: null,
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

describe('links of source and follow-up tickets across the border (QT-1, ADR-0067)', () => {
	const conflicts = () => answer().conflicts as Record<string, unknown>;
	const crossing = {
		counts: { ...(answer().counts as object), ticket_sources: 2 },
		conflicts: {
			...conflicts(),
			ticket_sources: [
				{
					ticket: { id: 'tick00000000001', key: 'PRIV-1', title: 'Eins' },
					other: { id: 'tick00000000005', key: 'PRIV-5', title: 'Heizung prüfen' },
					relation: 'source',
					trashed: false
				},
				{
					ticket: { id: 'tick00000000001', key: 'PRIV-1', title: 'Eins' },
					other: { id: 'tick00000000006', key: 'PRIV-6', title: 'Reparatur' },
					relation: 'follow_up',
					trashed: true
				}
			]
		},
		needs: { project: true, dependencies: true, ticket_sources: true, codes: [] }
	};

	it('reads them, a server before QT-1 names none', () => {
		const old = preview();
		expect(old.conflicts.ticketSources).toEqual([]);
		expect(old.counts.ticketSources).toBe(0);
		expect(old.needs.ticketSources).toBe(false);

		const shown = preview(crossing);
		expect(shown.needs.ticketSources).toBe(true);
		expect(shown.conflicts.ticketSources.map(ticketSourceLine)).toEqual([
			'PRIV-1 stammt aus PRIV-5 „Heizung prüfen“',
			'PRIV-6 „Reparatur“ (im Papierkorb) stammt aus PRIV-1'
		]);
		expect(countLines(shown).at(-1)).toBe('2 Verknüpfungen von Quell- und Folge-Tickets');
	});

	it('asks for the choice and sends it as ticket_sources', () => {
		const shown = preview(crossing);
		const chosen = { ...initialChoices(shown), project: '', dependencies: 'take' as const };
		expect(Object.keys(choiceErrors(shown, chosen, true, true))).toEqual(['ticketSources']);
		expect(choiceErrors(shown, { ...chosen, ticketSources: 'release' }, true, true)).toEqual({});
		const request = { kind: 'ticket' as const, ids: ['tick00000000001'], to: 'household' as const };
		expect(moveBody(request, { ...chosen, ticketSources: 'take' }, true)).toMatchObject({
			ticket_sources: 'take',
			preview: true
		});
		expect(moveBody(request, chosen, true)).not.toHaveProperty('ticket_sources');
	});
});

describe('whole series (MV-2)', () => {
	const series = {
		counts: {
			...(answer().counts as object),
			tickets: 14,
			subtasks: 1,
			items: 0,
			comments: 0,
			rules: 1,
			series: 1,
			occurrences: { open: 1, done: 12 }
		},
		series_offer: { rules: 1, open: 1, done: 12 },
		conflicts: { ...(answer().conflicts as object), series: [], rule_tickets: 0 }
	};

	it('reads the series, their occurrences and the offer; a server before MV-2 names none', () => {
		const old = preview();
		expect(old.counts.series).toBe(0);
		expect(old.counts.occurrences).toEqual({ open: 0, done: 0 });
		expect(old.seriesOffer).toEqual({ rules: 0, open: 0, done: 0 });
		const shown = preview(series);
		expect(shown.counts.series).toBe(1);
		expect(shown.counts.occurrences).toEqual({ open: 1, done: 12 });
		expect(shown.seriesOffer).toEqual({ rules: 1, open: 1, done: 12 });
	});

	it('counts series, open and done occurrences apart and says the series runs on', () => {
		const shown = preview(series);
		expect(countLines(shown)).toEqual([
			'14 Tickets (davon 1 Unteraufgabe)',
			'1 Serie mit Regel und Vorlage',
			'1 offenes Vorkommen',
			'12 erledigte Vorkommen'
		]);
		expect(noteLines(shown)).toContain(
			'Die Serie läuft im Ziel weiter; ihr nächstes Ticket entsteht dort.'
		);
		const two = preview({
			...series,
			counts: { ...series.counts, rules: 2, series: 2, occurrences: { open: 2, done: 1 } }
		});
		expect(countLines(two).slice(1)).toEqual([
			'2 Serien mit Regel und Vorlage',
			'2 offene Vorkommen',
			'1 erledigtes Vorkommen'
		]);
		expect(noteLines(two)).toContain(
			'Die Serien laufen im Ziel weiter; ihre nächsten Tickets entstehen dort.'
		);
	});

	it('sends the choice only for a move that offers it, the done ones only with the series', () => {
		const request = { kind: 'rule' as const, ids: ['rule00000000001'], to: 'household' as const };
		const start = { project: null, dependencies: null, codes: {} };
		expect(moveBody(request, start, true)).not.toHaveProperty('series');
		expect(moveBody(request, { ...start, series: true, seriesDone: true }, true)).toMatchObject({
			series: true,
			series_done: true
		});
		expect(moveBody(request, { ...start, series: true, seriesDone: false }, false)).toMatchObject({
			series: true,
			series_done: false
		});
		expect(moveBody(request, { ...start, series: false, seriesDone: true }, false)).toMatchObject({
			series: false,
			series_done: false
		});
		expect([offersSeries('rule'), offersSeries('ticket')]).toEqual([true, true]);
		expect([offersSeries('project'), offersSeries('item')]).toEqual([false, false]);
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
