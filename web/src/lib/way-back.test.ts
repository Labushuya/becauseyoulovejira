// The way back of a page in the phone frame (MO-4, ADR-0073 addendum MO-4): the arrow goes back
// through the history only when the entry right before the page is the view it leads to, else it
// navigates like the × of the PC.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WayBack, backThroughHistory, entryOf, goBack, previousEntry } from './way-back';

const LIST = new URL('http://localhost:3000/?sort=titel&karte=heute');

describe('previousEntry', () => {
	it('names the page before for a link and a goto, which add an entry', () => {
		expect(previousEntry({ type: 'link', from: LIST })).toBe('/?sort=titel&karte=heute');
		expect(previousEntry({ type: 'goto', from: LIST })).toBe('/?sort=titel&karte=heute');
	});

	it('names the page before one step forward', () => {
		expect(previousEntry({ type: 'popstate', from: LIST, delta: 1 })).toBe(
			'/?sort=titel&karte=heute'
		);
	});

	it('knows nothing at the start, after a reload, a step back, several steps or a form', () => {
		expect(previousEntry({ type: 'enter', from: null })).toBeNull();
		expect(previousEntry({ type: 'link', from: null })).toBeNull();
		expect(previousEntry({ type: 'popstate', from: LIST, delta: -1 })).toBeNull();
		expect(previousEntry({ type: 'popstate', from: LIST, delta: 2 })).toBeNull();
		expect(previousEntry({ type: 'form', from: LIST })).toBeNull();
	});

	it('keeps path and query, not the fragment', () => {
		expect(entryOf(new URL('http://localhost:3000/tagesplan?tag=2026-10-20#x'))).toBe(
			'/tagesplan?tag=2026-10-20'
		);
	});
});

describe('WayBack', () => {
	it('follows every arrival', () => {
		const wayBack = new WayBack();
		expect(wayBack.isPrevious('/?sort=titel&karte=heute')).toBe(false);
		wayBack.arrived({ type: 'link', from: LIST });
		expect(wayBack.isPrevious('/?sort=titel&karte=heute')).toBe(true);
		expect(wayBack.isPrevious('/?sort=titel')).toBe(false);
		wayBack.arrived({ type: 'link', from: new URL('http://localhost:3000/tickets/abc') });
		expect(wayBack.isPrevious('/?sort=titel&karte=heute')).toBe(false);
		wayBack.arrived({ type: 'enter', from: null });
		expect(wayBack.isPrevious('/')).toBe(false);
	});
});

describe('goBack', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('goes back through the history when the view lies right before the page', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const navigate = vi.fn();
		const wayBack = new WayBack();
		wayBack.arrived({ type: 'link', from: new URL('http://localhost:3000/tagesplan') });
		goBack(wayBack, '/tagesplan', navigate);
		expect(back).toHaveBeenCalledOnce();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('navigates like the × otherwise, also outside the (app) layout', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const navigate = vi.fn();
		const wayBack = new WayBack();
		wayBack.arrived({ type: 'enter', from: null });
		goBack(wayBack, '/tagesplan', navigate);
		goBack(null, '/tagesplan', navigate);
		expect(back).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledTimes(2);
	});
});

describe('the way back of a form page (MO-6)', () => {
	it('names the entry before the page while the app knows it', () => {
		const wayBack = new WayBack();
		expect(wayBack.previous).toBeNull();
		wayBack.arrived({
			type: 'link',
			from: new URL('http://localhost:3000/eingang/item1?quelle=mail')
		});
		expect(wayBack.previous).toBe('/eingang/item1?quelle=mail');
		wayBack.arrived({ type: 'popstate', from: LIST, delta: -1 });
		expect(wayBack.previous).toBeNull();
	});

	it('goes back through the history only in the phone frame and only after a link of the app', () => {
		const wayBack = new WayBack();
		wayBack.arrived({ type: 'link', from: new URL('http://localhost:3000/eingang') });
		expect(backThroughHistory(true, wayBack)).toBe(true);
		expect(backThroughHistory(false, wayBack)).toBe(false);
		expect(backThroughHistory(true, null)).toBe(false);
		wayBack.arrived({ type: 'enter', from: null });
		expect(backThroughHistory(true, wayBack)).toBe(false);
	});
});
