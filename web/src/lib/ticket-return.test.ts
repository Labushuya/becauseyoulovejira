// Unit tests of the way back from a ticket to the place it was opened from (ADR-0054 §7, KX-2):
// which navigations count as the way back, the link the panel of the origin focuses when it opens,
// the focus back in the view (the link, else the heading, only when the focus is lost), and the
// layout that follows its navigations. Navigation is mocked; the DOM is jsdom.

import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TicketReturnHarness from '$lib/test/TicketReturnHarness.svelte';
import { PROJECTS_HOST } from './ticket-host';
import { TicketReturn } from './ticket-return.svelte';

type Callback = (navigation: unknown) => void;

const mocks = vi.hoisted(() => ({
	before: [] as ((navigation: unknown) => void)[],
	after: [] as ((navigation: unknown) => void)[]
}));

vi.mock('$app/navigation', () => ({
	beforeNavigate: (callback: Callback) => mocks.before.push(callback),
	afterNavigate: (callback: Callback) => mocks.after.push(callback)
}));

const TICKET = 'abc123def456ghi';
const PROJECT = 'proj00000000001';
const ORIGIN = 'http://localhost:3000';

/** One end of a navigation as SvelteKit names it. */
function end(path: string, routeId: string, id?: string) {
	return {
		url: new URL(path, ORIGIN),
		route: { id: routeId },
		params: id === undefined ? {} : { id }
	};
}

const fromTicket = (query = '') =>
	end(`/projekte/tickets/${TICKET}${query}`, '/(app)/projekte/tickets/[id]', TICKET);
const toProject = (id = PROJECT) => end(`/projekte/${id}`, '/(app)/projekte/[id]', id);
const toView = () => end('/projekte', '/(app)/projekte');

function view({ inList = true, inPanel = true } = {}) {
	document.body.innerHTML = `
		<h2 tabindex="-1" data-view-heading>Projekte</h2>
		<div data-view-part="list">${inList ? `<a href="/" data-ticket-link="${TICKET}">Ansicht</a>` : ''}</div>
		<div data-view-part="panel">${inPanel ? `<a href="/" data-ticket-link="${TICKET}">Panel</a>` : ''}</div>
		<input aria-label="Feld" />`;
}

afterEach(() => {
	document.body.innerHTML = '';
	mocks.before.length = 0;
	mocks.after.length = 0;
});

describe('way back from a ticket (ADR-0054 §7)', () => {
	it('names the link of the ticket in the panel it came from, else the one in the view', () => {
		view();
		const ret = new TicketReturn(PROJECTS_HOST);
		ret.follow(fromTicket(`?von=${PROJECT}`), toProject());
		expect(ret.focusTarget()?.textContent).toBe('Panel');

		view({ inPanel: false });
		expect(ret.focusTarget()?.textContent).toBe('Ansicht');
	});

	it('forgets the ticket on any other navigation', () => {
		view();
		const ret = new TicketReturn(PROJECTS_HOST);
		ret.follow(fromTicket(`?von=${PROJECT}`), toProject('proj00000000002'));
		expect(ret.focusTarget()).toBeNull();

		ret.follow(fromTicket(`?von=${PROJECT}`), toProject());
		ret.follow(toProject(), toView());
		expect(ret.focusTarget()).toBeNull();

		ret.follow(fromTicket(), end(`/projekte/tickets/other0000000001`, PROJECTS_HOST.panelRoute));
		expect(ret.focusTarget()).toBeNull();
		ret.follow(fromTicket(), null);
		expect(ret.focusTarget()).toBeNull();
	});

	it('gives the focus back in the view to the link, else to the heading, only when it is lost', async () => {
		view();
		const ret = new TicketReturn(PROJECTS_HOST);
		ret.follow(fromTicket('?q=Haus'), end('/projekte?q=Haus', '/(app)/projekte'));
		// The panel it does not come from gets nothing.
		expect(ret.focusTarget()).toBeNull();
		await ret.returnToView();
		expect(document.activeElement?.textContent).toBe('Ansicht');

		view({ inList: false });
		await ret.returnToView();
		expect(document.activeElement?.getAttribute('data-view-heading')).toBe('');

		view();
		const field = document.querySelector('input') as HTMLInputElement;
		field.focus();
		await ret.returnToView();
		expect(document.activeElement).toBe(field);
	});

	it('is followed by the layout of an area through its navigations', async () => {
		view();
		let ret: TicketReturn | null = null;
		render(TicketReturnHarness, {
			props: { host: PROJECTS_HOST, onready: (value: TicketReturn) => (ret = value) }
		});
		expect(ret).not.toBeNull();
		expect(mocks.before).toHaveLength(1);
		expect(mocks.after).toHaveLength(1);

		mocks.before[0]?.({ from: fromTicket(`?von=${PROJECT}`), to: toProject() });
		expect((ret as TicketReturn | null)?.focusTarget()?.textContent).toBe('Panel');

		mocks.before[0]?.({ from: fromTicket(), to: toView() });
		mocks.after[0]?.({ from: fromTicket(), to: toView() });
		await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Ansicht'));
	});
});
