// Tickets as sources (QT-1, ADR-0067), pure: the answers of the routes read strictly, the rules of
// the ticket picker of "Quelle hinzufügen → Ticket" (no circle), the chain of a refusal, the title
// and the request of a follow-up, and the history entries of both tickets.

import { describe, expect, it } from 'vitest';
import { describeHistoryEntry, historyLookups } from './history-format';
import { judge } from './ticket-picker';
import {
	cycleMessage,
	cyclePathOf,
	followUpFlag,
	followUpTitle,
	followUpTitleError,
	originHistoryText,
	originLabel,
	sourcePickerRules,
	toFollowUpOutcome,
	toTicketOrigins
} from './ticket-origins';
import type { TicketSummary } from './ticket';

function entry(id: string, key: string, extra: Record<string, unknown> = {}) {
	return {
		link: `link-${id}`,
		id,
		key,
		title: `Ticket ${key}`,
		status: 'open',
		trashed: false,
		created: '2026-10-01 08:00:00.000Z',
		created_by: 'user00000000001',
		...extra
	};
}

function candidate(id: string, scope = 'u:a'): TicketSummary {
	return {
		id,
		key: id,
		title: id,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		scope
	};
}

describe('answers of the routes', () => {
	it('reads the origins of a ticket', () => {
		expect(
			toTicketOrigins({
				ticket: 't1',
				sources: [entry('s1', 'HAUS-3', { status: 'done', trashed: true })],
				follow_ups: [entry('f1', 'HAUS-20')],
				descendants: ['f1', 'f2', 7],
				already: true
			})
		).toEqual({
			ticketId: 't1',
			sources: [
				{
					link: 'link-s1',
					id: 's1',
					key: 'HAUS-3',
					title: 'Ticket HAUS-3',
					status: 'done',
					trashed: true,
					created: '2026-10-01 08:00:00.000Z',
					createdBy: 'user00000000001'
				}
			],
			followUps: [expect.objectContaining({ id: 'f1', key: 'HAUS-20', trashed: false })],
			descendants: ['f1', 'f2'],
			already: true
		});
	});

	it('refuses anything else', () => {
		const valid = { ticket: 't1', sources: [], follow_ups: [], descendants: [] };
		expect(toTicketOrigins(valid)).not.toBeNull();
		for (const broken of [
			null,
			[],
			{ ...valid, ticket: 1 },
			{ ...valid, sources: null },
			{ ...valid, follow_ups: [{ ...entry('x', 'X-1'), status: 'kaputt' }] },
			{ ...valid, descendants: 'f1' }
		]) {
			expect(toTicketOrigins(broken), JSON.stringify(broken)).toBeNull();
		}
	});

	it('reads the follow-up created by the route', () => {
		expect(
			toFollowUpOutcome({
				id: 'n1',
				key: 'HAUS-21',
				title: 'Folge',
				project: '',
				source: { id: 's1', key: 'HAUS-3' }
			})
		).toEqual({
			id: 'n1',
			key: 'HAUS-21',
			title: 'Folge',
			project: null,
			source: { id: 's1', key: 'HAUS-3' }
		});
		expect(toFollowUpOutcome({ id: 'n1', key: 'HAUS-21', source: null })).toBeNull();
		expect(
			toFollowUpOutcome({ id: '', key: 'HAUS-21', source: { id: 's1', key: 'HAUS-3' } })
		).toBeNull();
	});
});

describe('the ticket picker of "Quelle hinzufügen → Ticket"', () => {
	it('leaves the ticket, its sources and every ticket that would close a circle out', () => {
		const rules = sourcePickerRules(
			{ id: 'self', scope: 'u:a' },
			{ sources: [{ ...toOrigin('src') }], descendants: ['down', 'further'] }
		);
		for (const id of ['self', 'src', 'down', 'further']) {
			expect(judge(candidate(id), rules), id).toEqual({ hide: true });
		}
		expect(judge(candidate('free'), rules)).toBeNull();
		expect(judge(candidate('other', 'h:house'), rules)).toEqual({
			reason: 'Liegt in einem anderen Bereich.'
		});
	});

	it('hides only the ticket itself while its origins are not loaded', () => {
		const rules = sourcePickerRules({ id: 'self', scope: 'u:a' }, null);
		expect(judge(candidate('self'), rules)).toEqual({ hide: true });
		expect(judge(candidate('down'), rules)).toBeNull();
	});
});

function toOrigin(id: string) {
	return {
		link: `link-${id}`,
		id,
		key: id,
		title: id,
		status: 'open' as const,
		trashed: false,
		created: '',
		createdBy: ''
	};
}

describe('texts', () => {
	it('names the chain of a refused circle', () => {
		expect(cycleMessage(['HAUS-20', 'HAUS-12', 'HAUS-3'])).toBe(
			'HAUS-20 stammt bereits (über HAUS-12) von HAUS-3 ab.'
		);
		expect(cycleMessage(['HAUS-20', 'HAUS-3'])).toBe('HAUS-20 stammt bereits von HAUS-3 ab.');
		expect(cyclePathOf({ path: ['A', 'B'] })).toEqual(['A', 'B']);
		expect(cyclePathOf({ path: ['A', 2] })).toBeNull();
		expect(cyclePathOf(undefined)).toBeNull();
	});

	it('suggests the title of a follow-up and checks it', () => {
		expect(followUpTitle(' Rasen ')).toBe('Folge: Rasen');
		expect(followUpTitle('a'.repeat(250))).toHaveLength(200);
		expect(followUpTitleError('  ')).toBe('Bitte einen Titel mit höchstens 200 Zeichen angeben.');
		expect(followUpTitleError('Folge: Rasen')).toBeNull();
		expect(followUpFlag('HAUS-3', 'HAUS-21')).toEqual({
			title: 'Folge-Ticket HAUS-21 angelegt.',
			description: 'Es stammt aus HAUS-3.',
			action: 'HAUS-3 öffnen'
		});
		expect(originLabel({ key: 'HAUS-7', trashed: true })).toBe('HAUS-7 (im Papierkorb)');
	});

	it('words the history of both tickets', () => {
		const value = JSON.stringify({ ticket: 's1', key: 'HAUS-3' });
		expect(originHistoryText('ticket_source', '', value)).toBe('Quelle hinzugefügt: HAUS-3');
		expect(originHistoryText('ticket_source', value, '')).toBe('Quelle entfernt: HAUS-3');
		expect(originHistoryText('follow_up', '', value)).toBe('Folge-Ticket: HAUS-3');
		expect(originHistoryText('follow_up', value, '')).toBe('Folge-Ticket entfernt: HAUS-3');
		expect(originHistoryText('ticket_source', '', 'kaputt')).toBe('Quelle hinzugefügt');

		const line = describeHistoryEntry(
			{
				id: 'h1',
				ticket: 't1',
				field: 'follow_up',
				oldValue: '',
				newValue: JSON.stringify({ ticket: 'f1', key: 'HAUS-20' }),
				user: '',
				created: '2026-10-05 10:00:00.000Z'
			},
			historyLookups([], []),
			null
		);
		expect(line.text).toBe('Folge-Ticket: HAUS-20');
	});
});
