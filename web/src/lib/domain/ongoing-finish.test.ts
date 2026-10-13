// The question before completing an ongoing project (VH-1, ADR-0065 addendum VH-1): which tickets
// ask, the title and the text for one ticket and for a bulk action.

import { describe, expect, it } from 'vitest';
import {
	ONGOING_FINISH_CONFIRM,
	ONGOING_FINISH_DAY_HINT,
	ongoingFinishOf,
	ongoingFinishQuestion,
	ongoingFinishText,
	ongoingFinishTitle,
	openOngoing
} from './ongoing-finish';

const project = (key: string, title = `Vorhaben ${key}`, status = 'open') => ({
	key,
	title,
	status,
	kind: 'ongoing'
});
const task = (key: string, status = 'open') => ({
	key,
	title: `Aufgabe ${key}`,
	status,
	kind: 'task'
});

describe('which tickets ask (VH-1)', () => {
	it('asks only for open ongoing projects; tasks, done ones and tickets without a kind never', () => {
		const before = { key: 'TASK-4', title: 'Alt', status: 'open' };
		const tickets = [
			project('HAUS-1'),
			task('HAUS-2'),
			project('HAUS-3', 'Fertig', 'done'),
			before,
			project('HAUS-5', 'Spanisch', 'waiting')
		];
		expect(openOngoing(tickets).map((ticket) => ticket.key)).toEqual(['HAUS-1', 'HAUS-5']);
		expect(ongoingFinishQuestion([task('HAUS-2'), before])).toBeNull();
		expect(ongoingFinishQuestion([project('HAUS-3', 'Fertig', 'done')])).toBeNull();
		expect(ongoingFinishQuestion([])).toBeNull();
		expect(ongoingFinishQuestion(tickets, 5)).toEqual({
			projects: [
				{ key: 'HAUS-1', title: 'Vorhaben HAUS-1' },
				{ key: 'HAUS-5', title: 'Spanisch' }
			],
			total: 5
		});
	});

	it('takes the projects as the total when the action names fewer tickets', () => {
		expect(ongoingFinishQuestion([project('HAUS-1'), project('HAUS-2')], 1)?.total).toBe(2);
	});
});

describe('the question (VH-1)', () => {
	it('asks for one project with its title and says what completing means, like the day plan', () => {
		const question = ongoingFinishOf({ key: 'HAUS-7', title: 'Spanisch lernen' });
		expect(question).toEqual({ projects: [{ key: 'HAUS-7', title: 'Spanisch lernen' }], total: 1 });
		expect(ongoingFinishQuestion([project('HAUS-7', 'Spanisch lernen')])).toEqual(question);
		expect(ongoingFinishTitle(question)).toBe('Vorhaben HAUS-7 abschließen?');
		expect(ongoingFinishText(question)).toBe(
			'„Spanisch lernen“ ist ein laufendes Vorhaben. Abgeschlossen ist es erledigt und erscheint nicht mehr täglich im Tagesplan.'
		);
		expect(ONGOING_FINISH_CONFIRM).toBe('Abschließen');
		expect(ONGOING_FINISH_DAY_HINT).toBe('Für heute allein reicht der Haken im Tagesplan.');
	});

	it('names the number of projects among the chosen tickets of a bulk action, and that "Abbrechen" keeps all', () => {
		const one = ongoingFinishQuestion([task('HAUS-1'), project('HAUS-2'), task('HAUS-3')]);
		expect(one && ongoingFinishTitle(one)).toBe('Vorhaben HAUS-2 abschließen?');
		expect(one && ongoingFinishText(one)).toBe(
			'Unter den 3 ausgewählten Tickets ist 1 laufendes Vorhaben: HAUS-2. Abgeschlossen ist es erledigt und erscheint nicht mehr täglich im Tagesplan. Mit „Abbrechen“ bleiben alle Tickets, wie sie sind.'
		);
		const two = ongoingFinishQuestion([project('HAUS-1'), task('HAUS-2'), project('HAUS-3')]);
		expect(two && ongoingFinishTitle(two)).toBe('2 Vorhaben abschließen?');
		expect(two && ongoingFinishText(two)).toBe(
			'Unter den 3 ausgewählten Tickets sind 2 laufende Vorhaben: HAUS-1 und HAUS-3. Abgeschlossen sind sie erledigt und erscheinen nicht mehr täglich im Tagesplan. Mit „Abbrechen“ bleiben alle Tickets, wie sie sind.'
		);
	});

	it('says so when every chosen ticket is a project, and names at most three keys', () => {
		const all = ongoingFinishQuestion([project('HAUS-1'), project('HAUS-2')]);
		expect(all && ongoingFinishText(all)).toBe(
			'Die 2 ausgewählten Tickets sind laufende Vorhaben: HAUS-1 und HAUS-2. Abgeschlossen sind sie erledigt und erscheinen nicht mehr täglich im Tagesplan.'
		);
		const many = ongoingFinishQuestion(
			['HAUS-1', 'HAUS-2', 'HAUS-3', 'HAUS-4', 'HAUS-5'].map((key) => project(key)),
			12
		);
		expect(many && ongoingFinishTitle(many)).toBe('5 Vorhaben abschließen?');
		expect(many && ongoingFinishText(many)).toMatch(
			/^Unter den 12 ausgewählten Tickets sind 5 laufende Vorhaben: HAUS-1, HAUS-2, HAUS-3 und 2 weitere\. /
		);
	});
});
