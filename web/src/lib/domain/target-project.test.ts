// Target project of the ways into the inbox (ADR-0049, package 1): its state with the catalog, the
// text in panel and column, what converting chooses in advance (never an archived or deleted
// project), the targets of "Gesammelt umwandeln", the filter and the groups of the inbox, and the
// texts of the cards.

import { describe, expect, it } from 'vitest';
import type { InboxItemSummary } from './inbox';
import type { Project } from './project';
import {
	NO_TARGET,
	bulkTargets,
	cardTargetHint,
	groupByTarget,
	inboxTargetsOf,
	matchesTarget,
	targetOfItem,
	targetPrefill,
	targetSavedText,
	targetState,
	targetText
} from './target-project';

const project = (
	id: string,
	name: string,
	code: string,
	extra: Partial<Project> = {}
): Project => ({
	id,
	name,
	code,
	archived: false,
	parentId: null,
	updated: '2026-10-01 10:00:00.000Z',
	...extra
});

const HAUS = project('haus00000000001', 'Haus', 'HAUS');
const GARTEN = {
	...project('garten000000001', 'Garten', 'GART', { parentId: 'haus00000000001' }),
	parent: { id: 'haus00000000001', name: 'Haus', code: 'HAUS' }
};
const ALT = project('alt000000000001', 'Alt', 'ALT', { archived: true });
const ARBEIT = project('arbeit000000001', 'Arbeit', 'ARB');
const PROJECTS = [ALT, ARBEIT, GARTEN, HAUS];

type Entry = Pick<InboxItemSummary, 'id' | 'targetProjectId' | 'sourceMeta'>;
const entry = (id: string, target: string | null, meta: Record<string, unknown> = {}): Entry => ({
	id,
	targetProjectId: target,
	sourceMeta: meta
});

describe('state of a target', () => {
	it('is none, active, archived or deleted', () => {
		expect(targetState(null, PROJECTS)).toEqual({ kind: 'none' });
		expect(targetState('', PROJECTS)).toEqual({ kind: 'none' });
		expect(targetState(HAUS.id, PROJECTS)).toEqual({ kind: 'active', project: HAUS });
		expect(targetState(ALT.id, PROJECTS)).toEqual({ kind: 'archived', project: ALT });
		// A stored ID the catalog does not know (the card of the files, ADR-0049 §1).
		expect(targetState('weg000000000001', PROJECTS)).toEqual({ kind: 'deleted' });
		expect(targetState(null, PROJECTS, true)).toEqual({ kind: 'deleted' });
	});

	it('of an entry: deleted only by the note of the server, unknown projects count as none', () => {
		expect(targetOfItem(entry('e1', HAUS.id), PROJECTS).kind).toBe('active');
		expect(targetOfItem(entry('e1', null, { target_gone: true }), PROJECTS)).toEqual({
			kind: 'deleted'
		});
		// The catalog is not loaded yet: nothing is chosen, nothing is said.
		expect(targetOfItem(entry('e1', HAUS.id), [])).toEqual({ kind: 'none' });
		expect(targetOfItem({ sourceMeta: {} }, PROJECTS)).toEqual({ kind: 'none' });
	});

	it('reads as text in panel and column', () => {
		expect(targetText(targetState(GARTEN.id, PROJECTS))).toBe('Haus › Garten (GART)');
		expect(targetText(targetState(ALT.id, PROJECTS))).toBe('Alt (ALT), archiviert');
		expect(targetText({ kind: 'deleted' })).toBe('gelöscht');
		expect(targetText({ kind: 'none' })).toBe('');
	});
});

describe('converting', () => {
	it('chooses an active target in advance and says why it does not choose another', () => {
		expect(targetPrefill(targetState(GARTEN.id, PROJECTS))).toEqual({
			project: GARTEN.id,
			hint: 'Vorbelegt mit dem Zielprojekt „Haus › Garten (GART)“ des Eingangswegs; du kannst es ändern.'
		});
		expect(targetPrefill(targetState(ALT.id, PROJECTS))).toEqual({
			project: null,
			hint: 'Das Zielprojekt „Alt (ALT)“ ist archiviert und wird nicht vorbelegt.'
		});
		expect(targetPrefill({ kind: 'deleted' })).toEqual({
			project: null,
			hint: 'Das Zielprojekt dieses Eintrags wurde gelöscht und wird nicht vorbelegt.'
		});
		expect(targetPrefill({ kind: 'none' })).toEqual({ project: null, hint: null });
	});

	it('gives each entry of "Gesammelt umwandeln" its active target and counts the others', () => {
		expect(
			bulkTargets(
				[
					entry('e1', HAUS.id),
					entry('e2', null),
					entry('e3', ALT.id),
					entry('e4', null, { target_gone: true }),
					entry('e5', GARTEN.id)
				],
				PROJECTS
			)
		).toEqual({ targets: { e1: HAUS.id, e5: GARTEN.id }, active: 2, unusable: 2 });
		expect(bulkTargets([entry('e1', null)], PROJECTS)).toEqual({
			targets: {},
			active: 0,
			unusable: 0
		});
	});
});

describe('filter and groups of the inbox', () => {
	it('filters by a project with its sub projects, or by entries without a target', () => {
		const items = [
			entry('e1', HAUS.id),
			entry('e2', GARTEN.id),
			entry('e3', ARBEIT.id),
			entry('e4', null)
		];
		const ids = (filter: string | null) =>
			items.filter((item) => matchesTarget(item, filter, PROJECTS)).map((item) => item.id);
		expect(ids(null)).toEqual(['e1', 'e2', 'e3', 'e4']);
		expect(ids(HAUS.id)).toEqual(['e1', 'e2']);
		expect(ids(GARTEN.id)).toEqual(['e2']);
		expect(ids(NO_TARGET)).toEqual(['e4']);
		expect(matchesTarget({}, NO_TARGET, PROJECTS)).toBe(true);
	});

	it('groups in the order of the tree, archived and unknown ones after, "Ohne Zielprojekt" last', () => {
		const items = [
			entry('e1', null),
			entry('e2', ALT.id),
			entry('e3', GARTEN.id),
			entry('e4', HAUS.id),
			entry('e5', 'fremd0000000001'),
			entry('e6', HAUS.id),
			entry('e7', ARBEIT.id)
		];
		expect(
			groupByTarget(items, PROJECTS).map((group) => [
				group.key,
				group.label,
				group.items.map((item) => item.id)
			])
		).toEqual([
			[ARBEIT.id, 'Arbeit (ARB)', ['e7']],
			[HAUS.id, 'Haus (HAUS)', ['e4', 'e6']],
			[GARTEN.id, 'Haus › Garten (GART)', ['e3']],
			[ALT.id, 'Alt (ALT), archiviert', ['e2']],
			['fremd0000000001', 'Unbekanntes Projekt', ['e5']],
			['', 'Ohne Zielprojekt', ['e1']]
		]);
		expect(groupByTarget([], PROJECTS)).toEqual([]);
	});
});

describe('cards', () => {
	it('read the stored targets of a user strictly', () => {
		expect(inboxTargetsOf({ files: HAUS.id, api: 'Haus', mail: HAUS.id })).toEqual({
			api: '',
			'whatsapp-web': '',
			files: HAUS.id
		});
		expect(inboxTargetsOf(null)).toEqual({ api: '', 'whatsapp-web': '', files: '' });
	});

	it('say what the target does and why an archived or deleted one does nothing', () => {
		const who = 'Neue Einträge dieser Verbindung';
		expect(cardTargetHint({ kind: 'none' }, who)).toBe(
			'Neue Einträge dieser Verbindung bekommen dieses Projekt; beim Umwandeln ist es vorbelegt. Gilt nur für neue Einträge.'
		);
		expect(cardTargetHint(targetState(ALT.id, PROJECTS), who)).toMatch(
			/archiviert.*nicht vorbelegt/
		);
		expect(cardTargetHint({ kind: 'deleted' }, who)).toMatch(
			/gibt es nicht mehr.*ohne Zielprojekt/
		);
		expect(targetSavedText('Gmail', HAUS)).toBe(
			'Neue Einträge von „Gmail“ bekommen jetzt das Zielprojekt „Haus (HAUS)“.'
		);
		expect(targetSavedText('Gmail', null)).toBe(
			'Neue Einträge von „Gmail“ kommen jetzt ohne Zielprojekt.'
		);
	});
});
