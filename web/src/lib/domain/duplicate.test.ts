// "Ticket duplizieren" (ADR-0045): the rules of the question in the SPA, since MV-2 also into the
// other area. The texts of the codes are compared with the hook in tests/unit/web-duplicate.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TAKE,
	DUPLICATE_AREA_TEXTS,
	DUPLICATE_MESSAGES,
	DUPLICATE_TITLE_MAX,
	copySourceHint,
	duplicateAreaOf,
	duplicateFormErrors,
	duplicateHistoryText,
	duplicateRequestBody,
	duplicateRequestOf,
	duplicateTitle,
	duplicatedElsewhereFlag,
	duplicatedFlag,
	initialDuplicateForm,
	toDuplicateTarget
} from './duplicate';
import { projectChoiceLabel } from './project-tree';
import { initialStatusOptions } from './series-template';

describe('duplicateTitle', () => {
	it('adds "(Kopie)" to the title of the original', () => {
		expect(duplicateTitle('Rasen mähen')).toBe('Rasen mähen (Kopie)');
		expect(duplicateTitle('  Rasen  ')).toBe('Rasen (Kopie)');
	});

	it('cuts a long title before the suffix, so the whole fits into 200 characters', () => {
		const exact = 'x'.repeat(DUPLICATE_TITLE_MAX - ' (Kopie)'.length);
		expect(duplicateTitle(exact)).toBe(`${exact} (Kopie)`);
		const long = duplicateTitle('y'.repeat(DUPLICATE_TITLE_MAX));
		expect(long).toHaveLength(DUPLICATE_TITLE_MAX);
		expect(long.endsWith('y… (Kopie)')).toBe(true);
	});
});

describe('the question', () => {
	it('starts with the title, the project if it takes tickets, every field but sub-tasks and comments, no status and no source', () => {
		const form = initialDuplicateForm({ title: 'Rasen', projectId: 'p1' }, ['p1', 'p2']);
		expect(form).toEqual({
			title: 'Rasen (Kopie)',
			status: '',
			takeProject: true,
			project: 'p1',
			take: { ...DEFAULT_TAKE },
			source: 'none',
			// "Ziel" (MV-2): the area of the original.
			to: 'private',
			targetProject: ''
		});
		expect(initialDuplicateForm({ title: 'Rasen', projectId: null }, [], 'household').to).toBe(
			'household'
		);
		// The own color is a field of the ticket as well (ADR-0052).
		expect(DEFAULT_TAKE).toEqual({
			description: true,
			priority: true,
			tags: true,
			due: true,
			parent: true,
			subtasks: false,
			comments: false,
			color: true
		});
		// An archived project takes no tickets: none at first.
		expect(initialDuplicateForm({ title: 'Rasen', projectId: 'old' }, ['p1']).project).toBe('');
		expect(initialDuplicateForm({ title: 'Rasen', projectId: null }, ['p1']).project).toBe('');
	});

	it('needs a title and a status before it sends', () => {
		expect(duplicateFormErrors({ title: 'Kopie', status: 'open' })).toEqual({});
		expect(duplicateFormErrors({ title: '  ', status: '' })).toEqual({
			title: DUPLICATE_MESSAGES.validation_duplicate_title,
			status: DUPLICATE_MESSAGES.validation_duplicate_status_required
		});
		expect(duplicateFormErrors({ title: 'x'.repeat(201), status: 'waiting' })).toEqual({
			title: DUPLICATE_MESSAGES.validation_duplicate_title
		});
	});

	it('sends the chosen project only while "Projekt" is checked', () => {
		const form = {
			...initialDuplicateForm({ title: 'Rasen', projectId: 'p1' }, ['p1']),
			status: 'backlog' as const
		};
		expect(duplicateRequestOf({ ...form, title: ' Neu ' })).toEqual({
			title: 'Neu',
			status: 'backlog',
			project: 'p1',
			take: { ...DEFAULT_TAKE },
			source: 'none'
		});
		expect(duplicateRequestOf({ ...form, takeProject: false }).project).toBeNull();
		expect(duplicateRequestOf({ ...form, project: '' }).project).toBeNull();
	});

	it('offers the status like "Folgetickets starten mit", naming the original, never "Erledigt"', () => {
		const answers = (status: string) =>
			initialStatusOptions(status, 'das Original').map(({ value, label }) => [value, label]);
		expect(answers('in_progress')).toEqual([
			['open', 'Offen'],
			['in_progress', 'Wie das Original: In Arbeit'],
			['backlog', 'Backlog'],
			['waiting', 'Wartet']
		]);
		expect(answers('open')[0]).toEqual(['open', 'Offen (wie das Original)']);
		expect(answers('done').map(([value]) => value)).toEqual([
			'open',
			'backlog',
			'in_progress',
			'waiting'
		]);
	});

	it('says what the copy of the main source holds, or why there is none', () => {
		const mail = { title: 'Rechnung', channel: 'mail' as const, original: 'mail.eml' };
		expect(copySourceHint(mail, 'HAUS-12')).toBe(
			'Ein neuer Eintrag als Kopie von „Rechnung“ (Postfach) wird die Hauptquelle des Duplikats, mit Text, Details und Originaldatei, gekennzeichnet als „Kopie aus HAUS-12“.'
		);
		expect(copySourceHint({ ...mail, channel: 'telegram', original: '' }, 'HAUS-12')).toContain(
			'(Telegram) wird die Hauptquelle des Duplikats, mit Text und Details,'
		);
		expect(copySourceHint(null, 'HAUS-12')).toBe(
			DUPLICATE_MESSAGES.validation_duplicate_source_missing
		);
	});

	it('names both keys in the flag and offers the way back to the original', () => {
		expect(duplicatedFlag('HAUS-12', 'HAUS-13')).toEqual({
			title: 'HAUS-12 dupliziert.',
			description: 'Das Duplikat ist HAUS-13.',
			action: 'HAUS-12 öffnen'
		});
	});
});

describe('into the other area (MV-2)', () => {
	const form = {
		...initialDuplicateForm({ title: 'Rasen', projectId: 'p1' }, ['p1'], 'private'),
		status: 'open' as const,
		source: 'copy' as const
	};

	it('knows the area of a ticket by its scope', () => {
		expect(duplicateAreaOf('h:house0000000001')).toBe('household');
		expect(duplicateAreaOf('u:user00000000001')).toBe('private');
	});

	it('sends the project of the target, never the parent and no source, and the area', () => {
		const elsewhere = { ...form, to: 'household' as const, targetProject: 'hp1' };
		expect(duplicateRequestOf(elsewhere, 'private')).toEqual({
			title: 'Rasen (Kopie)',
			status: 'open',
			project: 'hp1',
			take: { ...DEFAULT_TAKE, parent: false },
			source: 'none',
			to: 'household'
		});
		expect(duplicateRequestOf({ ...elsewhere, targetProject: '' }, 'private').project).toBeNull();
		// In the area of the original nothing changes: no `to`, the source as chosen.
		const same = duplicateRequestOf(form, 'private');
		expect(same).not.toHaveProperty('to');
		expect(same).toMatchObject({ project: 'p1', source: 'copy' });
		expect(duplicateRequestBody(duplicateRequestOf(elsewhere, 'private')).to).toBe('household');
		expect(duplicateRequestBody(same)).not.toHaveProperty('to');
	});

	it('reads the projects and tags of the target strictly, sub projects below their parent', () => {
		const target = toDuplicateTarget({
			to: 'household',
			scope: 'h:house0000000001',
			name: 'Haus Beispiel',
			projects: [
				{ id: 'proj00000000002', code: 'GART', name: 'Garten', parent: 'proj00000000001' },
				{ id: 'proj00000000001', code: 'HAUS', name: 'Haus', parent: '' },
				{ id: 'proj00000000003', code: 'AUTO', name: 'Auto', parent: '' }
			],
			tags: { reused: ['garten'], created: ['einkauf'] }
		});
		expect(target?.name).toBe('Haus Beispiel');
		expect(target?.projects.map((project) => projectChoiceLabel(project))).toEqual([
			'Haus (HAUS)',
			'Haus › Garten (GART)',
			'Auto (AUTO)'
		]);
		expect(target?.tags).toEqual({ reused: ['garten'], created: ['einkauf'] });
		for (const broken of [
			null,
			{},
			{ to: 'elsewhere', scope: 'x', projects: [], tags: { reused: [], created: [] } },
			{ to: 'private', scope: 'x', projects: [{}], tags: { reused: [], created: [] } },
			{ to: 'private', scope: 'x', projects: [], tags: { reused: [1], created: [] } }
		]) {
			expect(toDuplicateTarget(broken)).toBeNull();
		}
	});

	it('says how the tags arrive, where the duplicate goes and what stays', () => {
		expect(DUPLICATE_AREA_TEXTS.tags({ reused: ['garten'], created: ['einkauf', 'müll'] })).toBe(
			'Im Ziel nach Namen zugeordnet – vorhanden: garten; neu angelegt: einkauf, müll.'
		);
		expect(DUPLICATE_AREA_TEXTS.tags({ reused: [], created: [] })).toBe('');
		expect(DUPLICATE_AREA_TEXTS.note('household', 'Haus Beispiel')).toBe(
			'Das Duplikat kommt in den Haushalt „Haus Beispiel“; das Original bleibt unverändert, wo es ist.'
		);
		expect(DUPLICATE_AREA_TEXTS.note('private', '')).toBe(
			'Das Duplikat kommt in deinen Bereich Privat; das Original bleibt unverändert, wo es ist.'
		);
		expect(DUPLICATE_AREA_TEXTS.sources).toMatch(/Verbindungen privat/);
		expect(DUPLICATE_AREA_TEXTS.sources).toMatch(/Ticket-Quellen/);
	});

	it('names the area of the other ticket in the history and leads to the duplicate in the flag', () => {
		const to = JSON.stringify({ direction: 'to', ticket: '', key: 'HAUS-13', area: 'household' });
		const from = JSON.stringify({ direction: 'from', ticket: '', key: 'PRIV-4', area: 'private' });
		expect(duplicateHistoryText(to)).toBe('Dupliziert nach HAUS-13 (Haushalt)');
		expect(duplicateHistoryText(from)).toBe('Dupliziert aus PRIV-4 (Privat)');
		expect(duplicatedElsewhereFlag('PRIV-4', 'HAUS-13', 'household')).toEqual({
			title: 'PRIV-4 in den Haushalt dupliziert.',
			description: 'Das Duplikat ist HAUS-13; das Original bleibt hier.',
			action: 'HAUS-13 öffnen'
		});
		expect(duplicatedElsewhereFlag('HAUS-2', 'PRIV-9', 'private').title).toBe(
			'HAUS-2 ins Private dupliziert.'
		);
	});
});
