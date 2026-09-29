// Ticket picker (ADR-0042): normalisation and search without case and accents, the loose pattern of
// the server, the rules of the place (self, cycle, one level, area), the list with "Zuletzt",
// project groups, "Ohne Projekt" and "Erledigt", the limit, the active entry and the stored list
// of recently viewed tickets.

import { describe, expect, it } from 'vitest';
import { NO_PROJECT } from './list-query';
import type { ProjectRef, TicketSummary } from './ticket';
import {
	DONE_GROUP_LABEL,
	NO_PROJECT_GROUP_LABEL,
	PICKER_REASONS,
	RECENT_GROUP_LABEL,
	RECENT_LIMIT,
	RECENT_TICKETS_MAX,
	alreadyLinkedReason,
	blockTicket,
	hideTicket,
	judge,
	loosePattern,
	matchesWords,
	normalizeSearch,
	parentRules,
	parseRecentTickets,
	pickerList,
	pickerStatus,
	preferredIndex,
	rememberTicket,
	sameScope,
	searchWords,
	serializeRecentTickets,
	type PickerListInput
} from './ticket-picker';

const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARTEN: ProjectRef = {
	id: 'garten000000001',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parent: { id: HAUS.id, name: 'Haus', code: 'HAUS' }
};
const AUTO: ProjectRef = { id: 'auto00000000001', name: 'Auto', code: 'AUTO', archived: false };
const PROJECTS = [AUTO, HAUS, GARTEN];

let counter = 0;
function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	counter += 1;
	const id = `t${String(counter).padStart(14, '0')}`;
	return {
		id,
		key: `TASK-${counter}`,
		title: `Ticket ${counter}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		scope: 'u:owner0000000001',
		...overrides
	};
}

function input(overrides: Partial<PickerListInput>): PickerListInput {
	return {
		open: [],
		done: [],
		recentIds: [],
		words: [],
		onlyOpen: true,
		projectIds: null,
		projectOf: (entry) => PROJECTS.find((project) => project.id === entry.projectId) ?? null,
		projectOrder: [AUTO, HAUS, GARTEN],
		rules: [],
		limit: 100,
		...overrides
	};
}

describe('normalizeSearch and searchWords', () => {
	it.each([
		['Äpfel', 'apfel'],
		['äpfel', 'apfel'],
		['ÄPFEL', 'apfel'],
		['Straße', 'strasse'],
		['STRASSE', 'strasse'],
		['Crème brûlée', 'creme brulee'],
		['  Haus \t  Garten\n', 'haus garten'],
		['Mañana à Zürich', 'manana a zurich'],
		['', '']
	])('%j becomes %j', (text, expected) => {
		expect(normalizeSearch(text)).toBe(expected);
	});

	it('splits into words and gives none for blanks', () => {
		expect(searchWords(' Äpfel  kaufen ')).toEqual(['apfel', 'kaufen']);
		expect(searchWords('   ')).toEqual([]);
	});
});

describe('matchesWords', () => {
	const apples = ticket({ key: 'HAUS-12', title: 'Äpfel für die Straße kaufen' });

	it('finds without case and umlaut dots, over key and title', () => {
		for (const text of ['äpfel', 'Äpfel', 'apfel', 'APFEL', 'strasse', 'straße', 'haus-12', '12']) {
			expect(matchesWords(apples, searchWords(text)), text).toBe(true);
		}
	});

	it('joins several words with AND, in any order', () => {
		expect(matchesWords(apples, searchWords('kaufen äpfel'))).toBe(true);
		expect(matchesWords(apples, searchWords('äpfel birnen'))).toBe(false);
	});

	it('takes every ticket without words and follows a changed title', () => {
		expect(matchesWords(apples, [])).toBe(true);
		const renamed = { ...apples, title: 'Birnen' };
		expect(matchesWords(renamed, searchWords('äpfel'))).toBe(false);
		expect(matchesWords(renamed, searchWords('birnen'))).toBe(true);
	});
});

describe('loosePattern', () => {
	it('turns letters with accented forms into one-character wildcards', () => {
		expect(loosePattern('apfel')).toBe('%_pf_l%');
		expect(loosePattern('haus-12')).toBe('%h___-12%');
	});

	it('lets "ss" stand for ß and takes the LIKE characters literally', () => {
		expect(loosePattern('strasse')).toBe('%_tr_%_%');
		expect(loosePattern('50%')).toBe('%50\\%%');
		expect(loosePattern('a_b')).toBe('%_\\_b%');
		expect(loosePattern('x\\y')).toBe('%x\\\\_%');
	});

	it('finds a superset: the pattern matches every normalised text that contains the word', () => {
		// SQLite LIKE with `\` as escape, ASCII without case, `_` one character.
		const like = (pattern: string, text: string) => {
			let source = '';
			for (let index = 0; index < pattern.length; index += 1) {
				const char = pattern[index] ?? '';
				if (char === '\\') {
					index += 1;
					source += (pattern[index] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				} else if (char === '%') source += '[\\s\\S]*';
				else if (char === '_') source += '[\\s\\S]';
				else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			}
			return new RegExp(`^${source}$`, 'i').test(text);
		};
		for (const [word, title] of [
			['apfel', 'Äpfel kaufen'],
			['apfel', 'apfelbaum'],
			['strasse', 'Hauptstraße 5'],
			['creme', 'Crème brûlée'],
			['zurich', 'Zürich'],
			['haus-12', 'HAUS-12']
		] as const) {
			expect(like(loosePattern(word), title), `${word} in ${title}`).toBe(true);
		}
		expect(like(loosePattern('apfel'), 'Birne')).toBe(false);
	});
});

describe('rules of the place', () => {
	const self = ticket({ key: 'HAUS-1', parentId: null });

	it('hides the ticket itself and blocks the current parent, own sub-tasks and sub-tasks', () => {
		const current = ticket({ key: 'HAUS-2' });
		const child = ticket({ key: 'HAUS-3', parentId: self.id });
		const foreignChild = ticket({ key: 'HAUS-4', parentId: current.id });
		const free = ticket({ key: 'HAUS-5' });
		const rules = parentRules({ ...self, parentId: current.id });
		expect(judge(self, rules)).toEqual({ hide: true });
		expect(judge(current, rules)).toEqual({ reason: PICKER_REASONS.currentParent });
		expect(judge(child, rules)).toEqual({ reason: PICKER_REASONS.ownSubtask });
		expect(judge(foreignChild, rules)).toEqual({ reason: PICKER_REASONS.isSubtask });
		expect(judge(free, rules)).toBeNull();
	});

	it('keeps tickets of another area visible with the reason, unknown areas say nothing', () => {
		const other = ticket({ scope: 'h:house0000000001' });
		expect(judge(other, parentRules(self))).toEqual({ reason: PICKER_REASONS.otherScope });
		expect(judge(other, [sameScope(null)])).toBeNull();
		expect(judge({ ...other, scope: undefined }, [sameScope('u:owner0000000001')])).toBeNull();
	});

	it('hides or blocks single tickets; the first rule that speaks wins', () => {
		const one = ticket({ key: 'HAUS-9' });
		expect(judge(one, [hideTicket(one.id)])).toEqual({ hide: true });
		expect(judge(one, [blockTicket(one.id, alreadyLinkedReason('HAUS-9'))])).toEqual({
			reason: 'Der Eintrag gehört schon zu HAUS-9.'
		});
		expect(judge(one, [blockTicket(one.id, 'erst'), hideTicket(one.id)])).toEqual({
			reason: 'erst'
		});
	});
});

describe('pickerList', () => {
	it('lists recently viewed first, fills up with recently changed, then groups by project', () => {
		const garden = ticket({ key: 'GART-1', projectId: GARTEN.id });
		const garden2 = ticket({ key: 'GART-2', projectId: GARTEN.id });
		const house = ticket({ key: 'HAUS-1', projectId: HAUS.id });
		const car = ticket({ key: 'AUTO-1', projectId: AUTO.id });
		const loose = ticket({ key: 'TASK-9' });
		const fresh = ticket({
			key: 'HAUS-2',
			projectId: HAUS.id,
			updated: '2026-09-29 10:00:00.000Z'
		});
		const others = Array.from({ length: 6 }, (_, index) =>
			ticket({
				key: `AUTO-${index + 10}`,
				projectId: AUTO.id,
				updated: '2026-09-10 10:00:00.000Z'
			})
		);
		const list = pickerList(
			input({
				open: [garden, garden2, house, car, loose, fresh, ...others],
				recentIds: [loose.id, 'unknown00000001', garden.id]
			})
		);
		expect(list.groups.map((group) => group.label)).toEqual([
			RECENT_GROUP_LABEL,
			'Auto',
			'Haus',
			'Haus › Garten'
		]);
		const recent = list.groups[0]?.entries.map((entry) => entry.ticket.key);
		expect(recent).toHaveLength(RECENT_LIMIT);
		// Viewed ones in their order, then the newest changes (the ID breaks ties).
		expect(recent).toEqual(['TASK-9', 'GART-1', 'HAUS-2', 'AUTO-15', 'AUTO-14']);
		expect(list.groups[3]?.entries.map((entry) => entry.ticket.key)).toEqual(['GART-2']);
		// No ticket twice: the recent ones leave their project group.
		const keys = list.groups.flatMap((group) => group.entries.map((entry) => entry.ticket.key));
		expect(new Set(keys).size).toBe(keys.length);
		expect(list.total).toBe(12);
		expect(list.shown).toBe(12);
	});

	it('puts tickets without project and done ones last, done ones only without "Nur offene"', () => {
		const open = Array.from({ length: RECENT_LIMIT }, () => ticket({ projectId: HAUS.id }));
		const loose = ticket({ key: 'TASK-50', updated: '2026-08-01 10:00:00.000Z' });
		const done = ticket({
			key: 'HAUS-99',
			status: 'done',
			projectId: HAUS.id,
			updated: '2026-07-01 10:00:00.000Z'
		});
		const only = pickerList(input({ open: [...open, loose], done: [done] }));
		expect(only.groups.map((group) => group.label)).toEqual([
			RECENT_GROUP_LABEL,
			NO_PROJECT_GROUP_LABEL
		]);
		const all = pickerList(input({ open: [...open, loose], done: [done], onlyOpen: false }));
		expect(all.groups.map((group) => group.label)).toEqual([
			RECENT_GROUP_LABEL,
			NO_PROJECT_GROUP_LABEL,
			DONE_GROUP_LABEL
		]);
		expect(all.groups.at(-1)?.entries.map((entry) => entry.ticket.key)).toEqual(['HAUS-99']);
	});

	it('filters by words and by the project with its sub projects', () => {
		const apples = ticket({ title: 'Äpfel pflücken', projectId: GARTEN.id });
		const pears = ticket({ title: 'Birnen pflücken', projectId: HAUS.id });
		const car = ticket({ title: 'Äpfel fürs Auto', projectId: AUTO.id });
		const loose = ticket({ title: 'Apfelkuchen' });
		const open = [apples, pears, car, loose];
		const titles = (list: ReturnType<typeof pickerList>) =>
			list.groups.flatMap((group) => group.entries.map((entry) => entry.ticket.title)).sort();
		expect(titles(pickerList(input({ open, words: searchWords('apfel') })))).toEqual([
			'Apfelkuchen',
			'Äpfel fürs Auto',
			'Äpfel pflücken'
		]);
		expect(titles(pickerList(input({ open, words: searchWords('pflücken äpfel') })))).toEqual([
			'Äpfel pflücken'
		]);
		const family = new Set([HAUS.id, GARTEN.id]);
		expect(titles(pickerList(input({ open, projectIds: family })))).toEqual([
			'Birnen pflücken',
			'Äpfel pflücken'
		]);
		expect(titles(pickerList(input({ open, projectIds: new Set([NO_PROJECT]) })))).toEqual([
			'Apfelkuchen'
		]);
	});

	it('leaves hidden tickets out and keeps blocked ones in place with the reason', () => {
		const self = ticket();
		const child = ticket({ parentId: 'x00000000000001' });
		const list = pickerList(input({ open: [self, child], rules: parentRules(self) }));
		const entries = list.groups.flatMap((group) => group.entries);
		expect(entries.map((entry) => entry.ticket.id)).toEqual([child.id]);
		expect(entries[0]?.reason).toBe(PICKER_REASONS.isSubtask);
		expect(list.total).toBe(1);
	});

	it('shows at most `limit` entries and counts all matches', () => {
		const open = Array.from({ length: 40 }, () => ticket({ projectId: AUTO.id }));
		const list = pickerList(input({ open, limit: 25 }));
		expect(list.shown).toBe(25);
		expect(list.total).toBe(40);
		expect(list.groups.flatMap((group) => group.entries)).toHaveLength(25);
	});

	it('names projects the catalog does not know after the known ones, by path', () => {
		const stranger: ProjectRef = {
			id: 'zzz000000000001',
			name: 'Büro',
			code: 'BUE',
			archived: false
		};
		const open = [
			...Array.from({ length: RECENT_LIMIT }, () =>
				ticket({ projectId: AUTO.id, updated: '2026-09-20 10:00:00.000Z' })
			),
			ticket({ projectId: stranger.id }),
			ticket({ projectId: HAUS.id })
		];
		const list = pickerList(
			input({
				open,
				projectOf: (entry) =>
					[...PROJECTS, stranger].find((project) => project.id === entry.projectId) ?? null
			})
		);
		expect(list.groups.map((group) => group.label)).toEqual([RECENT_GROUP_LABEL, 'Haus', 'Büro']);
	});
});

describe('preferredIndex and pickerStatus', () => {
	it('prefers the typed key, else the first choosable entry', () => {
		const blocked = { ticket: ticket({ key: 'HAUS-1' }), reason: 'nein' };
		const first = { ticket: ticket({ key: 'HAUS-12' }), reason: null };
		const exact = { ticket: ticket({ key: 'HAUS-120' }), reason: null };
		expect(preferredIndex([blocked, first, exact], 'haus-120')).toBe(2);
		expect(preferredIndex([blocked, first, exact], 'haus')).toBe(1);
		expect(preferredIndex([blocked], '')).toBe(-1);
	});

	it('says the number of hits and how many are shown', () => {
		expect(pickerStatus({ shown: 0, total: 0 }, false)).toBe('Kein Ticket gefunden.');
		expect(pickerStatus({ shown: 0, total: 0 }, true)).toBe(
			'Noch kein Ticket gefunden. „Mehr anzeigen“ lädt weitere erledigte.'
		);
		expect(pickerStatus({ shown: 1, total: 1 }, false)).toBe('1 Ticket.');
		expect(pickerStatus({ shown: 12, total: 12 }, false)).toBe('12 Tickets.');
		expect(pickerStatus({ shown: 25, total: 48 }, false)).toBe('25 von 48 Tickets angezeigt.');
		expect(pickerStatus({ shown: 20, total: 20 }, true)).toBe(
			'20 von mehr als 20 Tickets angezeigt.'
		);
	});
});

describe('recently viewed tickets', () => {
	const USER = 'user00000000001';
	const A = 'a00000000000001';
	const B = 'b00000000000002';

	it('reads only the list of the same user with valid IDs', () => {
		const stored = serializeRecentTickets(USER, [A, B, A, 'bad', 7 as unknown as string]);
		expect(parseRecentTickets(stored, USER)).toEqual([A, B]);
		expect(parseRecentTickets(stored, 'other0000000001')).toEqual([]);
		expect(parseRecentTickets(stored, null)).toEqual([]);
		for (const raw of [null, '', '{', '[]', '"x"', '{"user":"x"}']) {
			expect(parseRecentTickets(raw, USER), String(raw)).toEqual([]);
		}
	});

	it('moves a viewed ticket to the front and keeps at most RECENT_TICKETS_MAX', () => {
		expect(rememberTicket([A, B], B)).toEqual([B, A]);
		expect(rememberTicket([A], 'no id')).toEqual([A]);
		const many = Array.from(
			{ length: RECENT_TICKETS_MAX },
			(_, index) => `r${String(index).padStart(14, '0')}`
		);
		const next = rememberTicket(many, A);
		expect(next).toHaveLength(RECENT_TICKETS_MAX);
		expect(next[0]).toBe(A);
		expect(next).not.toContain(many.at(-1));
	});
});
