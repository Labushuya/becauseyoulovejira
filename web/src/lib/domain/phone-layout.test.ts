// Rules of the phone layout (MO-1a, ADR-0073): the one breakpoint, the switch and the decision, the
// meta viewport of the frame, the start with the day plan, the order of the bottom bar and of
// "Mehr", what the bar marks and which focus opens the on-screen keyboard; since MO-1b where a
// modal stands and when leaving the page asks first.

import { describe, expect, it } from 'vitest';
import { CALENDAR_NARROW_QUERY } from './calendar';
import {
	MOBILE_LAYOUT_ATTRIBUTE,
	MOBILE_LAYOUT_ON,
	MOBILE_LAYOUT_STORAGE_KEY,
	PHONE_BAR_VIEWS,
	PHONE_MORE_VIEWS,
	PHONE_QUERY,
	VIEWPORT_BASE,
	VIEWPORT_PHONE,
	VIEW_ORDER,
	isPhoneLayout,
	isPhoneStart,
	modalPlacement,
	opensKeyboard,
	opensWithDayPlan,
	parseMobileLayout,
	phoneBarTarget,
	viewportContent,
	warnsBeforeLeaving,
	type ModalSize,
	type StartAddress
} from './phone-layout';

const ORIGIN = 'http://192.168.178.20:8090';

function start(overrides: Partial<StartAddress> = {}): StartAddress {
	return {
		pathname: '/',
		search: '',
		hash: '',
		referrer: '',
		origin: ORIGIN,
		navigation: 'navigate',
		...overrides
	};
}

describe('phone layout: breakpoint and switch', () => {
	it('has one breakpoint below 40rem, the same as the agenda of the calendar', () => {
		expect(PHONE_QUERY).toBe('(max-width: 39.99rem)');
		expect(CALENDAR_NARROW_QUERY).toBe(PHONE_QUERY);
	});

	it('stores only "on" under its own key and names the root attribute', () => {
		expect(MOBILE_LAYOUT_STORAGE_KEY).toBe('byl-mobile-layout');
		expect(MOBILE_LAYOUT_ON).toBe('on');
		expect(MOBILE_LAYOUT_ATTRIBUTE).toBe('data-mobile-layout');
	});

	it.each([
		['on', true],
		['off', false],
		['ON', false],
		['1', false],
		['true', false],
		['', false],
		[null, false],
		[undefined, false]
	])('reads %j as %s (off by default)', (value, enabled) => {
		expect(parseMobileLayout(value)).toBe(enabled);
	});

	it('applies the frame only with the switch on and a narrow window', () => {
		expect(isPhoneLayout(true, true)).toBe(true);
		expect(isPhoneLayout(true, false)).toBe(false);
		expect(isPhoneLayout(false, true)).toBe(false);
		expect(isPhoneLayout(false, false)).toBe(false);
	});
});

describe('phone layout: meta viewport', () => {
	it('keeps the viewport of today without the frame', () => {
		expect(VIEWPORT_BASE).toBe('width=device-width, initial-scale=1');
		expect(viewportContent(false)).toBe(VIEWPORT_BASE);
	});

	it('adds viewport-fit and interactive-widget only for the frame', () => {
		expect(viewportContent(true)).toBe(VIEWPORT_PHONE);
		expect(VIEWPORT_PHONE).toBe(
			'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'
		);
	});
});

describe('phone layout: the day plan as the start view', () => {
	it('starts with the day plan at the bare start page opened from outside', () => {
		expect(isPhoneStart(start())).toBe(true);
		expect(isPhoneStart(start({ referrer: 'https://example.com/' }))).toBe(true);
		// A browser that does not say how the document came.
		expect(isPhoneStart(start({ navigation: '' }))).toBe(true);
	});

	it.each([
		['a link with the state of the list', { search: '?karte=heute' }],
		['a link to a ticket', { pathname: '/tickets/abc123def456ghi' }],
		['the day plan itself', { pathname: '/tagesplan' }],
		['a link with a fragment', { hash: '#oben' }],
		['a page of the app loading "/" anew after an update', { referrer: `${ORIGIN}/projekte` }],
		['"Aufgaben" reloaded (pulled down to refresh)', { navigation: 'reload' }],
		['the way back to "Aufgaben"', { navigation: 'back_forward' }]
	])('keeps %s', (_name, overrides) => {
		expect(isPhoneStart(start(overrides))).toBe(false);
	});

	it('takes a referrer it cannot read for one from outside', () => {
		expect(isPhoneStart(start({ referrer: 'kein Link' }))).toBe(true);
	});

	// MO-7c2: the bare login page leads to the bare start page after the sign-in (guard.ts).
	it('counts the bare login page as the start page, not one that leads elsewhere', () => {
		expect(isPhoneStart(start({ pathname: '/login' }))).toBe(true);
		expect(isPhoneStart(start({ pathname: '/login', search: '?redirect=%2Ftickets' }))).toBe(false);
		expect(isPhoneStart(start({ pathname: '/login', navigation: 'reload' }))).toBe(false);
	});
});

// MO-7c2: decided once, when the app shows, from the address held before the session check.
describe('phone layout: the start decided when the app shows (MO-7c2)', () => {
	const BARE = { pathname: '/', search: '', hash: '' };

	it('opens the day plan in the frame when the app opened at its start page and shows it now', () => {
		expect(opensWithDayPlan(start(), BARE, true)).toBe(true);
		// After the sign-in at the bare login page the app shows the bare start page.
		expect(opensWithDayPlan(start({ pathname: '/login' }), BARE, true)).toBe(true);
	});

	it.each([
		['outside the frame (the PC, the switch off)', start(), BARE, false],
		['without an address of the start (a second sign-in in the same tab)', null, BARE, true],
		['for an app opened at another address', start({ pathname: '/tagesplan' }), BARE, true],
		['for an app reloaded at "Aufgaben"', start({ navigation: 'reload' }), BARE, true],
		[
			'when the app shows another page than the start page',
			start(),
			{ ...BARE, pathname: '/tickets/abc123def456ghi' },
			true
		],
		[
			'when the app shows the start page with a state',
			start(),
			{ ...BARE, search: '?sort=titel' },
			true
		]
	])('keeps the page %s', (_name, address, shown, phone) => {
		expect(opensWithDayPlan(address, shown, phone)).toBe(false);
	});
});

describe('phone layout: bottom bar and "Mehr"', () => {
	it('keeps the fixed order of the navigation (ADR-0066 §1)', () => {
		expect(VIEW_ORDER).toEqual([
			'tasks',
			'dayplan',
			'projects',
			'inbox',
			'recurrences',
			'calendar',
			'done',
			'trash'
		]);
	});

	it('puts "Tagesplan", "Aufgaben" and "Eingang" into the bar (decision of the user)', () => {
		expect(PHONE_BAR_VIEWS).toEqual(['dayplan', 'tasks', 'inbox']);
	});

	it('puts every other view under "Mehr", in the fixed order, so none is missing', () => {
		expect(PHONE_MORE_VIEWS).toEqual(['projects', 'recurrences', 'calendar', 'done', 'trash']);
		expect([...PHONE_BAR_VIEWS, ...PHONE_MORE_VIEWS].sort()).toEqual([...VIEW_ORDER].sort());
	});

	it('marks a view of the bar, "Mehr" for the others and the settings, nothing elsewhere', () => {
		expect(phoneBarTarget('dayplan', false)).toBe('dayplan');
		expect(phoneBarTarget('tasks', false)).toBe('tasks');
		expect(phoneBarTarget('inbox', false)).toBe('inbox');
		for (const view of PHONE_MORE_VIEWS) expect(phoneBarTarget(view, false), view).toBe('more');
		expect(phoneBarTarget(null, true)).toBe('more');
		expect(phoneBarTarget(null, false)).toBeNull();
	});
});

// MO-1b: one rule for every modal of the app, in the building block.
describe('phone layout: where a modal stands', () => {
	const SIZES: readonly ModalSize[] = ['s', 'm', 'l', 'xl'];

	it('keeps every size where its owner asks outside the frame (the PC unchanged)', () => {
		for (const size of SIZES) {
			expect(modalPlacement(size, 'center', false), size).toBe('center');
			expect(modalPlacement(size, 'sheet', false), size).toBe('sheet');
		}
	});

	it('shows questions and short forms (S, M) as a sheet in the frame', () => {
		expect(modalPlacement('s', 'center', true)).toBe('sheet');
		expect(modalPlacement('m', 'center', true)).toBe('sheet');
	});

	it('shows large dialogs full of fields (L) and the full view (XL) as a page in the frame', () => {
		expect(modalPlacement('l', 'center', true)).toBe('page');
		expect(modalPlacement('xl', 'center', true)).toBe('page');
	});

	it('keeps a sheet asked for ("Mehr") a sheet in every size', () => {
		for (const size of SIZES) expect(modalPlacement(size, 'sheet', true), size).toBe('sheet');
	});
});

describe('phone layout: leaving the page with unsaved input', () => {
	it('asks only in the frame and only with unsaved input', () => {
		expect(warnsBeforeLeaving(true, true)).toBe(true);
		expect(warnsBeforeLeaving(true, false)).toBe(false);
		expect(warnsBeforeLeaving(false, true)).toBe(false);
		expect(warnsBeforeLeaving(false, false)).toBe(false);
	});
});

describe('phone layout: the on-screen keyboard', () => {
	it.each([
		['a text field', { tagName: 'INPUT', type: 'text' }],
		['a field without a type', { tagName: 'INPUT' }],
		['a search field', { tagName: 'INPUT', type: 'search' }],
		['an e-mail field', { tagName: 'INPUT', type: 'email' }],
		['a number field', { tagName: 'INPUT', type: 'number' }],
		['a text area', { tagName: 'TEXTAREA' }],
		['the editor', { tagName: 'DIV', isContentEditable: true }]
	])('opens it for %s', (_name, target) => {
		expect(opensKeyboard(target)).toBe(true);
	});

	it.each([
		['a check box', { tagName: 'INPUT', type: 'checkbox' }],
		['a radio', { tagName: 'INPUT', type: 'radio' }],
		['a date field (a picker)', { tagName: 'INPUT', type: 'date' }],
		['a file field', { tagName: 'INPUT', type: 'file' }],
		['a read-only field', { tagName: 'INPUT', type: 'text', readOnly: true }],
		['a read-only text area', { tagName: 'TEXTAREA', readOnly: true }],
		['a select (a picker)', { tagName: 'SELECT' }],
		['a button', { tagName: 'BUTTON' }],
		['a link', { tagName: 'A' }],
		['nothing', null]
	])('does not open it for %s', (_name, target) => {
		expect(opensKeyboard(target)).toBe(false);
	});
});
