// The views of the navigation (ADR-0066 §1) and, since MO-6 (ADR-0073 addendum MO-6), the arrow
// back of a page in the phone frame: whether the page before it is the page of a view, and how the
// arrow is named and where it leads.

import { describe, expect, it } from 'vitest';
import { VIEW_ORDER } from '$lib/domain/phone-layout';
import { VIEW_BACK_LABELS, arrowBack, viewHref, viewOfEntry, viewPath } from './views';

describe('links of the views', () => {
	it('links every view plainly from elsewhere, with its state while it is shown', () => {
		const url = new URL('http://localhost/eingang?zustand=verworfen');
		expect(VIEW_ORDER.map((view) => viewPath(view))).toEqual([
			'/',
			'/tagesplan',
			'/projekte',
			'/eingang',
			'/wiederholungen',
			'/kalender',
			'/erledigt',
			'/papierkorb'
		]);
		expect(viewHref('inbox', 'inbox', url)).toBe('/eingang?zustand=verworfen');
		expect(viewHref('inbox', 'tasks', url)).toBe('/eingang');
		expect(viewHref('trash', 'trash', url)).toBe('/papierkorb');
	});
});

describe('the arrow back of a page in the phone frame (MO-6)', () => {
	it('knows the page of a view in any state, but not a panel, a form, a ticket or the settings', () => {
		expect(viewOfEntry('/eingang?zustand=verworfen&quelle=mail')).toBe('inbox');
		expect(viewOfEntry('/tagesplan?tag=2026-10-19')).toBe('dayplan');
		expect(viewOfEntry('/')).toBe('tasks');
		expect(viewOfEntry('/?sort=titel')).toBe('tasks');
		expect(viewOfEntry('/papierkorb')).toBe('trash');
		for (const entry of [
			'/eingang/item00000000001',
			'/eingang/neu',
			'/tickets/neu?aus=item00000000001',
			'/tickets/tick00000000001',
			'/einstellungen/darstellung'
		]) {
			expect(viewOfEntry(entry), entry).toBeNull();
		}
	});

	it('names the way back after the views, as their tickets do', () => {
		expect(VIEW_BACK_LABELS).toEqual({
			tasks: 'Zur Liste',
			dayplan: 'Zum Tagesplan',
			projects: 'Zu den Projekten',
			inbox: 'Zum Eingang',
			recurrences: 'Zu den Wiederholungen',
			calendar: 'Zum Kalender',
			done: 'Zu den Erledigten',
			trash: 'Zum Papierkorb'
		});
	});

	it('goes back through the history to the view right before the page, named after it', () => {
		expect(arrowBack('/eingang?quelle=mail', 'inbox')).toEqual({
			label: 'Zum Eingang',
			throughHistory: true
		});
		// "Eintrag ansehen" of the quick entry on the day plan: back to the view of the capture.
		expect(arrowBack('/tagesplan', 'inbox')).toEqual({
			label: 'Zum Tagesplan',
			throughHistory: true
		});
		expect(arrowBack('/kalender?ansicht=monat', 'calendar')).toEqual({
			label: 'Zum Kalender',
			throughHistory: true
		});
	});

	it('leads to its own view with a new navigation from elsewhere, as the × does', () => {
		for (const previous of [
			null,
			'/tickets/neu?aus=item00000000001',
			'/eingang/tickets/tick00000000001?von=item00000000001',
			'/eingang/neu'
		]) {
			expect(arrowBack(previous, 'inbox'), String(previous)).toEqual({
				label: 'Zum Eingang',
				throughHistory: false
			});
		}
		expect(arrowBack(null, 'calendar')).toEqual({ label: 'Zum Kalender', throughHistory: false });
	});
});
