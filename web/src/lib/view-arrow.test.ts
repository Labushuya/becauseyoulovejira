// The arrow of a panel shown as a page in the phone frame (MO-6 for an entry of the inbox; since MO-7b
// shared by the project, the rule and the preview of the trash, ADR-0073 addendum MO-7b): back through
// the history when the page of a view lies right before it, named after that view, like the back
// gesture of Android; otherwise a new navigation to the view of the page, like the × on the PC.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { ViewArrow } from './view-arrow.svelte';

const PROJECTS = '/projekte?suche=haus' as ResolvedPathname;

function arrow(own: 'projects' | 'recurrences' | 'trash' | 'calendar' = 'projects') {
	const navigate = vi.fn();
	return {
		arrow: new ViewArrow(
			() => own,
			() => PROJECTS,
			navigate
		),
		navigate
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the arrow of a page of a list view (MO-7b)', () => {
	it('goes back through the history to the list right before it, named after it', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const { arrow: way, navigate } = arrow();
		way.arrived({ type: 'link', from: new URL('http://localhost/projekte?suche=haus') });
		expect(way.label).toBe('Zu den Projekten');
		way.go();
		expect(back).toHaveBeenCalledOnce();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('names the view right before it, also another one, and a step forward counts as well', () => {
		vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const { arrow: way } = arrow('trash');
		way.arrived({ type: 'popstate', from: new URL('http://localhost/tagesplan'), delta: 1 });
		expect(way.label).toBe('Zum Tagesplan');
		way.arrived({ type: 'link', from: new URL('http://localhost/papierkorb') });
		expect(way.label).toBe('Zum Papierkorb');
	});

	it('navigates to the view of the page when the page before is unknown or no view', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const { arrow: way, navigate } = arrow('recurrences');
		expect(way.label).toBe('Zu den Wiederholungen');
		way.go();
		expect(navigate).toHaveBeenCalledWith(PROJECTS);

		for (const arrival of [
			{ type: 'enter', from: null },
			{ type: 'link', from: new URL('http://localhost/wiederholungen/tickets/tick00000000001') },
			{ type: 'link', from: new URL('http://localhost/wiederholungen/neu') },
			{ type: 'popstate', from: new URL('http://localhost/wiederholungen'), delta: -1 }
		]) {
			navigate.mockClear();
			way.arrived(arrival);
			expect(way.label).toBe('Zu den Wiederholungen');
			way.go();
			expect(navigate).toHaveBeenCalledOnce();
		}
		expect(back).not.toHaveBeenCalled();
	});

	it('names the calendar for a rule next to the calendar', () => {
		const { arrow: way } = arrow('calendar');
		expect(way.label).toBe('Zum Kalender');
	});
});
