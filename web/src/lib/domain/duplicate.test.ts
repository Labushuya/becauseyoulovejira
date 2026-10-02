// "Ticket duplizieren" (ADR-0045): the rules of the question in the SPA. The texts of the codes are
// compared with the hook in tests/unit/web-duplicate.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TAKE,
	DUPLICATE_MESSAGES,
	DUPLICATE_TITLE_MAX,
	copySourceHint,
	duplicateFormErrors,
	duplicateRequestOf,
	duplicateTitle,
	duplicatedFlag,
	initialDuplicateForm
} from './duplicate';
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
			source: 'none'
		});
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
