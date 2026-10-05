// Unit tests of the hosts of a ticket (ADR-0053 §6, ADR-0054): the addresses of the areas projects,
// inbox and rules with the state of their view and the panel a ticket replaced (`von`), the way
// back, the link that gets the focus afterwards, and `ticketLinks()`, whose `path` follows the host
// (the current address) and leads to "Aufgaben" without state from places without one. Next to the
// calendar a ticket replaces a rule or an inbox entry (`von=regel-<id>`, `von=eintrag-<id>`), and
// "Ticket ansehen" of the quick entry opens in the view of the route (ADR-0054 §8).

import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
import TicketLinksHarness from '$lib/test/TicketLinksHarness.svelte';
import {
	CALENDAR_HOST,
	CALENDAR_RULE_ROUTE,
	DONE_HOST,
	INBOX_HOST,
	LIST_HOST,
	PROJECTS_HOST,
	RECURRENCES_HOST,
	isTicketRoute,
	ticketHrefIn,
	ticketLinkIn
} from './ticket-host';
import {
	ORIGIN_PARAM,
	calendarHref,
	calendarItemHref,
	calendarOriginFrom,
	calendarRuleHref,
	ticketOriginFrom
} from './ticket-links';

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));

const ID = 'abc123def456ghi';
const PROJECT = 'proj00000000001';
const ITEM = 'item00000000001';
const RULE = 'rule00000000001';

const at = (path: string) => new URL(path, 'http://localhost:3000');

afterEach(() => {
	document.body.innerHTML = '';
	mocks.page.url = at('/');
});

describe('origin of a ticket in an area', () => {
	it('is the panel shown at the address, else the parameter "von" of a ticket', () => {
		expect(ORIGIN_PARAM).toBe('von');
		expect(ticketOriginFrom('projekte', at(`/projekte/${PROJECT}?q=Haus`))).toBe(PROJECT);
		expect(ticketOriginFrom('eingang', at(`/eingang/${ITEM}`))).toBe(ITEM);
		expect(ticketOriginFrom('wiederholungen', at(`/wiederholungen/${RULE}`))).toBe(RULE);
		expect(ticketOriginFrom('projekte', at(`/projekte/tickets/${ID}?von=${PROJECT}`))).toBe(
			PROJECT
		);
	});

	it('is none for the view, "neu", a value that is no record ID or a repeated one', () => {
		expect(ticketOriginFrom('projekte', at('/projekte?q=Haus'))).toBeNull();
		expect(ticketOriginFrom('projekte', at('/projekte/neu'))).toBeNull();
		expect(ticketOriginFrom('eingang', at('/eingang/neu?vorlage=link'))).toBeNull();
		expect(ticketOriginFrom('projekte', at(`/projekte/tickets/${ID}`))).toBeNull();
		expect(ticketOriginFrom('projekte', at(`/projekte/tickets/${ID}?von=kurz`))).toBeNull();
		expect(
			ticketOriginFrom('projekte', at(`/projekte/tickets/${ID}?von=${PROJECT}&von=${PROJECT}`))
		).toBeNull();
	});
});

describe('hosts of the areas', () => {
	it('name panel and full view in the projects with the state of the view and the origin', () => {
		const panel = at(`/projekte/${PROJECT}?darstellung=kacheln&sort=name&unbekannt=1`);
		expect(PROJECTS_HOST.panel(ID, panel)).toBe(
			`/projekte/tickets/${ID}?sort=name&darstellung=kacheln&von=${PROJECT}`
		);
		expect(PROJECTS_HOST.full(ID, panel)).toBe(
			`/projekte/tickets/${ID}/voll?sort=name&darstellung=kacheln&von=${PROJECT}`
		);
		expect(PROJECTS_HOST.panel(ID, at('/projekte?q=Haus'))).toBe(`/projekte/tickets/${ID}?q=Haus`);
		// Another ticket from a ticket keeps the panel it replaced.
		const ticket = at(`/projekte/tickets/other0000000001?q=Haus&von=${PROJECT}`);
		expect(PROJECTS_HOST.panel(ID, ticket)).toBe(`/projekte/tickets/${ID}?q=Haus&von=${PROJECT}`);
	});

	it('lead back to the panel the ticket replaced, else to the view', () => {
		expect(PROJECTS_HOST.view(at(`/projekte/tickets/${ID}?q=Haus&von=${PROJECT}`))).toBe(
			`/projekte/${PROJECT}?q=Haus`
		);
		expect(PROJECTS_HOST.view(at(`/projekte/tickets/${ID}/voll?q=Haus`))).toBe('/projekte?q=Haus');
		expect(INBOX_HOST.view(at(`/eingang/tickets/${ID}?quelle=mail&von=${ITEM}`))).toBe(
			`/eingang/${ITEM}?quelle=mail`
		);
		expect(INBOX_HOST.view(at(`/eingang/tickets/${ID}?quelle=mail`))).toBe('/eingang?quelle=mail');
		expect(RECURRENCES_HOST.view(at(`/wiederholungen/tickets/${ID}?von=${RULE}`))).toBe(
			`/wiederholungen/${RULE}`
		);
		expect(RECURRENCES_HOST.view(at(`/wiederholungen/tickets/${ID}`))).toBe('/wiederholungen');
	});

	it('take the chips of the inbox and nothing of the rules', () => {
		expect(INBOX_HOST.panel(ID, at(`/eingang/${ITEM}?zustand=alle&quelle=mail`))).toBe(
			`/eingang/tickets/${ID}?quelle=mail&zustand=alle&von=${ITEM}`
		);
		expect(RECURRENCES_HOST.full(ID, at(`/wiederholungen/${RULE}?x=1`))).toBe(
			`/wiederholungen/tickets/${ID}/voll?von=${RULE}`
		);
		expect(INBOX_HOST.origin(at(`/eingang/tickets/${ID}?von=${ITEM}`))).toBe(ITEM);
	});

	it('know their routes and their way back when the ticket is gone', () => {
		expect(isTicketRoute(PROJECTS_HOST, '/(app)/projekte/tickets/[id]')).toBe(true);
		expect(isTicketRoute(PROJECTS_HOST, '/(app)/projekte/tickets/[id]/voll')).toBe(true);
		expect(isTicketRoute(PROJECTS_HOST, '/(app)/projekte/[id]')).toBe(false);
		expect(isTicketRoute(INBOX_HOST, '/(app)/eingang/tickets/[id]')).toBe(true);
		expect(isTicketRoute(RECURRENCES_HOST, '/(app)/wiederholungen/tickets/[id]/voll')).toBe(true);
		expect(isTicketRoute(RECURRENCES_HOST, null)).toBe(false);
		expect([PROJECTS_HOST, INBOX_HOST, RECURRENCES_HOST].map((host) => host.backLabel)).toEqual([
			'Zu den Projekten',
			'Zum Eingang',
			'Zu den Wiederholungen'
		]);
	});

	it('mark the project, entry or rule of the panel or the one a ticket came from, never a ticket', () => {
		const page = (routeId: string, path: string, id?: string) => ({
			route: { id: routeId },
			params: id === undefined ? {} : { id },
			url: at(path)
		});
		expect(
			PROJECTS_HOST.activeIn(page('/(app)/projekte/[id]', `/projekte/${PROJECT}`, PROJECT))
		).toBe(PROJECT);
		expect(
			PROJECTS_HOST.activeIn(
				page('/(app)/projekte/tickets/[id]', `/projekte/tickets/${ID}?von=${PROJECT}`, ID)
			)
		).toBe(PROJECT);
		expect(
			INBOX_HOST.activeIn(
				page('/(app)/eingang/tickets/[id]/voll', `/eingang/tickets/${ID}/voll`, ID)
			)
		).toBeNull();
		expect(
			RECURRENCES_HOST.activeIn(page('/(app)/wiederholungen/neu', '/wiederholungen/neu'))
		).toBeNull();
		expect(RECURRENCES_HOST.activeIn(page('/(app)/wiederholungen', '/wiederholungen'))).toBeNull();
	});

	it('show the panel column for panels and tickets, not for the view or a full view', () => {
		expect(PROJECTS_HOST.panelShown('/(app)/projekte')).toBe(false);
		expect(PROJECTS_HOST.panelShown('/(app)/projekte/[id]')).toBe(true);
		expect(PROJECTS_HOST.panelShown('/(app)/projekte/neu')).toBe(true);
		expect(PROJECTS_HOST.panelShown('/(app)/projekte/tickets/[id]')).toBe(true);
		expect(PROJECTS_HOST.panelShown('/(app)/projekte/tickets/[id]/voll')).toBe(false);
		expect(INBOX_HOST.panelShown('/(app)/eingang/tickets/[id]/voll')).toBe(false);
		expect(INBOX_HOST.panelShown('/(app)/eingang/neu')).toBe(true);
		expect(RECURRENCES_HOST.panelShown('/(app)/wiederholungen')).toBe(false);
	});

	it('find the link of the ticket in the panel it came from, else in the view', () => {
		document.body.innerHTML = `
			<div data-view-part="list"><a href="/" data-ticket-link="${ID}">Ansicht</a></div>
			<div data-view-part="panel"><a href="/" data-ticket-link="${ID}">Panel</a></div>`;
		const fromPanel = at(`/projekte/tickets/${ID}?von=${PROJECT}`);
		expect(PROJECTS_HOST.entryOf(ID, fromPanel)?.textContent).toBe('Panel');
		expect(PROJECTS_HOST.entryOf(ID, at(`/projekte/tickets/${ID}`))?.textContent).toBe('Ansicht');
		expect(PROJECTS_HOST.entryOf(ID)?.textContent).toBe('Ansicht');
		document.querySelector('[data-view-part="panel"] a')?.remove();
		expect(PROJECTS_HOST.entryOf(ID, fromPanel)?.textContent).toBe('Ansicht');
		expect(PROJECTS_HOST.entryOf('other0000000001', fromPanel)).toBeNull();
		expect(ticketLinkIn(null, ID)).toBeNull();
	});
});

describe('ticketLinks() below a host', () => {
	function openMode(full: boolean) {
		const store = new TicketOpenModeStore(null);
		store.choose(full ? 'full' : 'panel');
		return store;
	}

	const hrefOf = (name: 'href' | 'path') => screen.getByRole('link', { name }).getAttribute('href');

	it('stays in the area: `path` takes the current address with the panel it replaces', () => {
		mocks.page.url = at(`/eingang/${ITEM}?quelle=mail`);
		render(TicketLinksHarness, {
			props: {
				id: ID,
				url: at('/eingang?zustand=alle'),
				host: INBOX_HOST,
				openMode: openMode(false)
			}
		});
		expect(hrefOf('path')).toBe(`/eingang/tickets/${ID}?quelle=mail&von=${ITEM}`);
		expect(hrefOf('href')).toBe(`/eingang/tickets/${ID}?zustand=alle`);
	});

	it('opens the full view where it is remembered', () => {
		mocks.page.url = at(`/wiederholungen/${RULE}`);
		render(TicketLinksHarness, {
			props: {
				id: ID,
				url: at('/wiederholungen'),
				host: RECURRENCES_HOST,
				openMode: openMode(true)
			}
		});
		expect(hrefOf('path')).toBe(`/wiederholungen/tickets/${ID}/voll?von=${RULE}`);
	});

	it('leads to "Aufgaben" without state from a place without a host (the trash)', () => {
		mocks.page.url = at('/papierkorb?x=1');
		render(TicketLinksHarness, { props: { id: ID, url: at('/?status=open') } });
		expect(hrefOf('path')).toBe(`/tickets/${ID}`);
		expect(hrefOf('href')).toBe(`/tickets/${ID}?status=open`);
		expect(LIST_HOST.path?.(ID, 'full')).toBe(`/tickets/${ID}/voll`);
	});

	it('stays in the calendar with its state', () => {
		mocks.page.url = at('/kalender?ansicht=woche');
		render(TicketLinksHarness, {
			props: { id: ID, url: at('/kalender'), host: CALENDAR_HOST, openMode: openMode(false) }
		});
		expect(hrefOf('path')).toBe(`/kalender/tickets/${ID}?ansicht=woche`);
	});

	it('replaces a rule next to the calendar with its ticket', () => {
		mocks.page.url = at(`/kalender/wiederholungen/${RULE}?ansicht=woche`);
		render(TicketLinksHarness, {
			props: { id: ID, url: at('/kalender'), host: CALENDAR_HOST, openMode: openMode(false) }
		});
		expect(hrefOf('path')).toBe(`/kalender/tickets/${ID}?ansicht=woche&von=regel-${RULE}`);
	});
});

describe('calendar: rules and inbox entries next to it (ADR-0054 §8)', () => {
	it('names the rule or entry of the panel, or the one a ticket replaced, as the origin', () => {
		expect(calendarOriginFrom(at(`/kalender/wiederholungen/${RULE}?ansicht=woche`))).toEqual({
			kind: 'regel',
			id: RULE
		});
		expect(calendarOriginFrom(at(`/kalender/eingang/${ITEM}`))).toEqual({
			kind: 'eintrag',
			id: ITEM
		});
		expect(calendarOriginFrom(at(`/kalender/tickets/${ID}?von=regel-${RULE}`))).toEqual({
			kind: 'regel',
			id: RULE
		});
		expect(CALENDAR_HOST.origin(at(`/kalender/tickets/${ID}?von=eintrag-${ITEM}`))).toBe(
			`eintrag-${ITEM}`
		);
	});

	it('names none for the calendar, a ticket of it or a value of another form', () => {
		expect(calendarOriginFrom(at('/kalender?ansicht=woche'))).toBeNull();
		expect(calendarOriginFrom(at(`/kalender/tickets/${ID}`))).toBeNull();
		expect(calendarOriginFrom(at(`/kalender/tickets/${ID}?von=${RULE}`))).toBeNull();
		expect(calendarOriginFrom(at(`/kalender/tickets/${ID}?von=projekt-${PROJECT}`))).toBeNull();
		expect(
			calendarOriginFrom(at(`/kalender/tickets/${ID}?von=regel-${RULE}&von=regel-${RULE}`))
		).toBeNull();
		expect(CALENDAR_HOST.origin(at(`/kalender/tickets/${ID}`))).toBeNull();
	});

	it('opens rules, entries and their tickets with the state of the calendar', () => {
		const rule = at(`/kalender/wiederholungen/${RULE}?ansicht=woche&prio=high`);
		expect(CALENDAR_HOST.panel(ID, rule)).toBe(
			`/kalender/tickets/${ID}?ansicht=woche&prio=high&von=regel-${RULE}`
		);
		expect(CALENDAR_HOST.full(ID, at(`/kalender/eingang/${ITEM}`))).toBe(
			`/kalender/tickets/${ID}/voll?von=eintrag-${ITEM}`
		);
		// Another ticket from a ticket keeps the panel it replaced; a rule or entry does not take it.
		const ticket = at(`/kalender/tickets/other0000000001?ansicht=woche&von=regel-${RULE}`);
		expect(CALENDAR_HOST.panel(ID, ticket)).toBe(
			`/kalender/tickets/${ID}?ansicht=woche&von=regel-${RULE}`
		);
		expect(calendarRuleHref(RULE, ticket)).toBe(`/kalender/wiederholungen/${RULE}?ansicht=woche`);
		expect(calendarItemHref(ITEM, at('/kalender?datum=2026-10-08'))).toBe(
			`/kalender/eingang/${ITEM}?datum=2026-10-08`
		);
	});

	it('leads back from a ticket to the rule or entry it replaced, else to the calendar', () => {
		expect(CALENDAR_HOST.view(at(`/kalender/tickets/${ID}?ansicht=woche&von=regel-${RULE}`))).toBe(
			`/kalender/wiederholungen/${RULE}?ansicht=woche`
		);
		expect(CALENDAR_HOST.view(at(`/kalender/tickets/${ID}/voll?von=eintrag-${ITEM}`))).toBe(
			`/kalender/eingang/${ITEM}`
		);
		expect(CALENDAR_HOST.view(at(`/kalender/tickets/${ID}?ansicht=woche`))).toBe(
			'/kalender?ansicht=woche'
		);
		expect(calendarHref(at(`/kalender/eingang/${ITEM}?ansicht=agenda`))).toBe(
			'/kalender?ansicht=agenda'
		);
	});

	it('finds the link of the ticket in the panel it came from, else its entry in the calendar', () => {
		document.body.innerHTML = `
			<div data-view-part="list"><a href="/" data-calendar-ticket="${ID}">Kalender</a></div>
			<div data-view-part="panel"><a href="/" data-ticket-link="${ID}">Regel</a></div>`;
		const fromRule = at(`/kalender/tickets/${ID}?von=regel-${RULE}`);
		expect(CALENDAR_HOST.entryOf(ID, fromRule)?.textContent).toBe('Regel');
		expect(CALENDAR_HOST.entryOf(ID, at(`/kalender/tickets/${ID}`))?.textContent).toBe('Kalender');
		expect(CALENDAR_HOST.entryOf(ID)?.textContent).toBe('Kalender');
	});
});

describe('ticketHrefIn: "Ticket ansehen" of the quick entry (ADR-0054 §8)', () => {
	it('opens the ticket in the view of the route, in place of its panel, in the way asked', () => {
		expect(ticketHrefIn(ID, '/(app)/(tickets)', at('/?status=open'), 'panel')).toBe(
			`/tickets/${ID}?status=open`
		);
		const rule = at(`/kalender/wiederholungen/${RULE}?ansicht=woche`);
		expect(ticketHrefIn(ID, CALENDAR_RULE_ROUTE, rule, 'panel')).toBe(
			`/kalender/tickets/${ID}?ansicht=woche&von=regel-${RULE}`
		);
		expect(ticketHrefIn(ID, '/(app)/projekte/[id]', at(`/projekte/${PROJECT}`), 'full')).toBe(
			`/projekte/tickets/${ID}/voll?von=${PROJECT}`
		);
		expect(ticketHrefIn(ID, '/(app)/eingang', at('/eingang?quelle=mail'), 'panel')).toBe(
			`/eingang/tickets/${ID}?quelle=mail`
		);
		const ticket = at(`/wiederholungen/tickets/other0000000001?von=${RULE}`);
		expect(ticketHrefIn(ID, RECURRENCES_HOST.panelRoute, ticket, 'panel')).toBe(
			`/wiederholungen/tickets/${ID}?von=${RULE}`
		);
		// "Erledigte" (ADR-0066) with its filters.
		expect(ticketHrefIn(ID, '/(app)/erledigt', at('/erledigt?q=Miete&prio=high'), 'full')).toBe(
			`/erledigt/tickets/${ID}/voll?q=Miete`
		);
	});

	it('opens a ticket next to "Erledigte" with its filters and leads back there (ADR-0066)', () => {
		const url = at(`/erledigt/tickets/${ID}?projekt=${PROJECT}&charm=auto`);
		expect(DONE_HOST.panel(ID, url)).toBe(`/erledigt/tickets/${ID}?projekt=${PROJECT}&charm=auto`);
		expect(DONE_HOST.full(ID, url)).toBe(
			`/erledigt/tickets/${ID}/voll?projekt=${PROJECT}&charm=auto`
		);
		expect(DONE_HOST.view(url)).toBe(`/erledigt?projekt=${PROJECT}&charm=auto`);
		expect(DONE_HOST.origin(url)).toBeNull();
		expect(isTicketRoute(DONE_HOST, '/(app)/erledigt/tickets/[id]/voll')).toBe(true);
		expect(isTicketRoute(DONE_HOST, '/(app)/erledigt')).toBe(false);
	});

	it('leads to "Aufgaben" without state outside of the views', () => {
		const settings = at('/einstellungen/konto?x=1');
		expect(ticketHrefIn(ID, '/(app)/einstellungen/konto', settings, 'panel')).toBe(
			`/tickets/${ID}`
		);
		expect(ticketHrefIn(ID, '/(app)/papierkorb/[id]', at('/papierkorb/x'), 'full')).toBe(
			`/tickets/${ID}/voll`
		);
		expect(ticketHrefIn(ID, null, at('/'), 'panel')).toBe(`/tickets/${ID}`);
		// A route that only starts like a view is none of it.
		expect(ticketHrefIn(ID, '/(app)/kalenderx', at('/kalenderx'), 'panel')).toBe(`/tickets/${ID}`);
	});
});
