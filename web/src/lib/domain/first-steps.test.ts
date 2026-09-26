// "Erste Schritte" (plan EH-12): the stored value is read defensively, steps are reached once and in
// a fixed order, progress counts only the offered steps, and the list shows until it is dismissed
// or complete.

import { describe, expect, it } from 'vitest';
import {
	EMPTY_FIRST_STEPS,
	FIRST_STEPS,
	FIRST_STEP_IDS,
	firstStepsProgress,
	parseFirstSteps,
	progressText,
	reachStep,
	serializeFirstSteps,
	showsFirstSteps
} from './first-steps';

const WITHOUT_TOUR = FIRST_STEP_IDS.filter((id) => id !== 'tour');

describe('first steps', () => {
	it('lists five steps in German, the tour last', () => {
		expect(FIRST_STEPS.map((step) => step.label)).toEqual([
			'Erstes Ticket anlegen',
			'Schnellerfassung ausprobieren',
			'Einen Kanal einrichten',
			'Ein Projekt anlegen',
			'Kurze Einführung starten'
		]);
	});

	it.each([
		[null, EMPTY_FIRST_STEPS],
		['', EMPTY_FIRST_STEPS],
		['nicht json', EMPTY_FIRST_STEPS],
		['42', EMPTY_FIRST_STEPS],
		['null', EMPTY_FIRST_STEPS],
		['{"dismissed":"ja","reached":"ticket"}', EMPTY_FIRST_STEPS],
		['{"dismissed":true}', { dismissed: true, reached: [] }],
		[
			'{"dismissed":false,"reached":["project","böse","ticket","ticket",1]}',
			{ dismissed: false, reached: ['ticket', 'project'] }
		]
	])('reads %j defensively', (raw, expected) => {
		expect(parseFirstSteps(raw)).toEqual(expected);
	});

	it('writes what it reads', () => {
		const state = { dismissed: true, reached: ['quick', 'tour'] as const };
		expect(parseFirstSteps(serializeFirstSteps(state))).toEqual(state);
	});

	it('reaches a step once, in the order of the list', () => {
		const first = reachStep(EMPTY_FIRST_STEPS, 'project');
		const second = reachStep(first, 'ticket');
		expect(second.reached).toEqual(['ticket', 'project']);
		expect(reachStep(second, 'ticket')).toBe(second);
		expect(EMPTY_FIRST_STEPS.reached).toEqual([]);
	});

	it('counts only the offered steps', () => {
		const state = { dismissed: false, reached: ['ticket', 'tour'] as const };
		const progress = firstStepsProgress(state, WITHOUT_TOUR);
		expect(progress.items.map((item) => [item.id, item.done])).toEqual([
			['ticket', true],
			['quick', false],
			['channel', false],
			['project', false]
		]);
		expect(progressText(progress)).toBe('1 von 4 erledigt');
		expect(progress.complete).toBe(false);
		expect(firstStepsProgress(state, FIRST_STEP_IDS).done).toBe(2);
	});

	it('shows until dismissed or complete', () => {
		expect(showsFirstSteps(EMPTY_FIRST_STEPS, WITHOUT_TOUR)).toBe(true);
		expect(showsFirstSteps({ dismissed: true, reached: [] }, WITHOUT_TOUR)).toBe(false);
		const allButTour = { dismissed: false, reached: WITHOUT_TOUR };
		expect(showsFirstSteps(allButTour, WITHOUT_TOUR)).toBe(false);
		// With the tour on offer one step is still open.
		expect(showsFirstSteps(allButTour, FIRST_STEP_IDS)).toBe(true);
		expect(firstStepsProgress(EMPTY_FIRST_STEPS, []).complete).toBe(false);
	});
});
