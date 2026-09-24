// Numbers of the KPI tiles (E3 plan, T-10 and package 12; ADR-0010 section 1). Pure. The tiles
// count every ticket that is not done, independent of filters and search; done tickets never
// count. The due tiles use the same buckets as the due filter (domain/filter.ts), so a click on
// a tile shows exactly the counted tickets.

import type { CalendarDate } from './berlin-date';
import { dueBucket } from './filter';
import type { TicketSummary } from './ticket';

export interface Kpis {
	/** Every ticket that is not done (equals the header counter). */
	notDone: number;
	inProgress: number;
	dueToday: number;
	overdue: number;
	urgent: number;
}

export type CountableTicket = Pick<TicketSummary, 'status' | 'priority' | 'due'>;

export function countKpis(tickets: Iterable<CountableTicket>, today: CalendarDate): Kpis {
	const kpis: Kpis = { notDone: 0, inProgress: 0, dueToday: 0, overdue: 0, urgent: 0 };
	for (const ticket of tickets) {
		if (ticket.status === 'done') continue;
		kpis.notDone += 1;
		if (ticket.status === 'in_progress') kpis.inProgress += 1;
		if (ticket.priority === 'urgent') kpis.urgent += 1;
		const bucket = dueBucket(ticket.due, today);
		if (bucket === 'today') kpis.dueToday += 1;
		else if (bucket === 'overdue') kpis.overdue += 1;
	}
	return kpis;
}
