// Parity of the options of a ticket (NT-1, ADR-0069): everything that can be set at a ticket can be
// set in "Neues Ticket", except the exceptions of the registry domain/ticket-options.ts with their
// reason. The detail (side panel and full view) marks every option at its control with
// `data-ticket-option`, the menu "•••" names its entries; the form marks the same keys. The test
// fails when the detail shows an option the registry does not know, when the registry names an option
// the form does not offer at its place (main fields or "Weitere Optionen", in the order of the detail)
// without a reason, and when a new part or a new row of the detail carries no key.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { MOVE_TEXTS } from '$lib/domain/area-move';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { MORE_OPTIONS_KEY } from '$lib/domain/ticket-create';
import { TICKET_OPTIONS, createKeys, ticketOption } from '$lib/domain/ticket-options';
import { fixedAssignees } from '$lib/stores/assignees.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import { fakePickerSource } from '$lib/test/ticket-picker-fake';
import NewTicketForm from '$lib/components/NewTicketForm.svelte';
import TicketFields from '$lib/components/TicketFields.svelte';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
useProseMirrorStubs();

const COMPONENTS = resolve(import.meta.dirname, 'components');
const source = (name: string) => readFileSync(join(COMPONENTS, `${name}.svelte`), 'utf8');

/** The parts of the detail that show options of a ticket, with their keys at the controls. */
const DETAIL_PARTS = [
	'EditableTitle',
	'TicketFields',
	'TicketParentField',
	'RecurrenceSummary',
	'TicketDescription',
	'TicketSubtasks',
	'TicketMeta',
	'TicketSources',
	'TicketFollowUps',
	'TicketActivity',
	'TicketPinToggle'
];

/** The menu "•••" of the detail: its entries are options by their label. */
const MENU = 'TicketActions';

/** Parts of the detail without an option of the ticket, each with the reason. */
const NO_OPTIONS: Readonly<Record<string, string>> = {
	Breadcrumbs: 'Pfad des Tickets, nur Links.',
	ColorMark: 'Zeigt die Farbe; gewählt wird sie in den Feldern.',
	ErrorIcon: 'Symbol der Fehlermeldungen.',
	TrashNotice: 'Hinweis auf den Papierkorb eines verschwundenen Tickets.',
	TicketDelete: 'Frage von „In den Papierkorb …“ (Eintrag des Menüs).',
	TicketDeleteQuestion: 'Frage von „In den Papierkorb …“ in der Vollansicht.',
	DuplicateDialog: 'Frage von „Duplizieren …“ (Eintrag des Menüs).',
	FollowUpDialog: 'Frage von „Folge-Ticket anlegen …“ (Eintrag des Menüs).',
	AreaMoveDialog: 'Frage des Verschiebens (Eintrag des Menüs).',
	TicketLeaveQuestion: 'Frage vor dem Verlassen mit ungespeichertem Text.',
	TicketActions: 'Das Menü „•••“; seine Einträge prüft dieser Test über ihre Namen.',
	ConfirmDialog: 'Frage vor dem Verlassen mit ungespeichertem Text.'
};

/** The keys a source names at its controls: `data-ticket-option="x"` or `{… ? 'x' : undefined}`. */
function markers(text: string): string[] {
	return [
		...text.matchAll(/data-ticket-option=(?:"([^"]+)"|\{[^}]*\?\s*'([^']+)'\s*:\s*undefined\})/g)
	].map((match) => match[1] ?? match[2] ?? '');
}

/** The literal labels of the entries of TicketActions. */
function menuLabels(text: string): string[] {
	return [...text.matchAll(/label: '([^']+)'/g)].map((match) => match[1] ?? '');
}

/** The components a file imports from the folder of the components. */
function parts(text: string): string[] {
	return [...text.matchAll(/import (\w+) from '\.\/(?:overlay\/)?(\w+)\.svelte'/g)].map(
		(match) => match[2] ?? ''
	);
}

const DETAIL_KEYS = DETAIL_PARTS.flatMap((part) => markers(source(part)));
const MENU_LABELS = [...menuLabels(source(MENU)), ...Object.values(MOVE_TEXTS.action)];

describe('the registry of the options (domain/ticket-options.ts)', () => {
	it('names each option once and gives every exception its reason', () => {
		const keys = TICKET_OPTIONS.map((option) => option.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const option of TICKET_OPTIONS) {
			if (option.create === null) {
				expect(option.reason?.length ?? 0, option.key).toBeGreaterThan(40);
			} else {
				expect(option.reason, option.key).toBeUndefined();
			}
		}
	});

	it('knows the exceptions of the product rule', () => {
		const exceptions = TICKET_OPTIONS.filter((option) => option.create === null).map(
			(option) => option.key
		);
		expect(exceptions).toEqual([
			'open',
			'copyLink',
			'duplicate',
			'followUp',
			'move',
			'trash',
			'meta',
			'followUps',
			'comments',
			'history',
			'read',
			'dependencies'
		]);
	});
});

describe('the detail and the registry', () => {
	it('knows every option the detail marks, and the detail marks every option of the registry', () => {
		for (const key of DETAIL_KEYS)
			expect(ticketOption(key), `${key} is not in the registry`).toBeDefined();
		for (const option of TICKET_OPTIONS) {
			if (option.detail === null) continue;
			const marked = DETAIL_KEYS.includes(option.key);
			const inMenu = (option.menu ?? []).some((label) => MENU_LABELS.includes(label));
			expect(marked || inMenu, `${option.key} is not marked in the detail`).toBe(true);
		}
	});

	it('knows every entry of the menu "•••"', () => {
		const known = TICKET_OPTIONS.flatMap((option) => option.menu ?? []);
		for (const label of MENU_LABELS) expect(known, label).toContain(label);
	});

	it('marks every row of the fields of a ticket', () => {
		const fields = source('TicketFields');
		const rows = [...fields.matchAll(/<div class="control"/g)].length;
		expect(rows).toBeGreaterThan(5);
		expect(markers(fields)).toHaveLength(rows);
	});

	it('classifies every part of panel and full view', () => {
		const used = new Set(
			['TicketPanel', 'TicketFullViewRoute', 'TicketRouteLayout'].flatMap((name) =>
				parts(source(name))
			)
		);
		used.delete('TicketPanel');
		for (const part of used) {
			expect(
				DETAIL_PARTS.includes(part) || Object.hasOwn(NO_OPTIONS, part) || isOverlay(part),
				`${part} of the detail is neither marked nor classified`
			).toBe(true);
		}
	});
});

/** Building blocks of the overlays (ADR-0025), no options of a ticket. */
function isOverlay(part: string): boolean {
	return ['Drawer', 'FullView', 'Modal', 'InlineDialog'].includes(part);
}

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const ME = 'user00000000001';
const MEMBERS = [
	{ id: ME, name: 'Anna Beispiel', self: true },
	{ id: 'user00000000002', name: 'Bert Beispiel', self: false }
];

/** A ticket of a household with every field a server after all migrations names. */
function householdTicket(): Ticket {
	return {
		id: 'ticket000000001',
		key: 'HAUS-12',
		title: 'Heizung warten',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		parentId: null,
		blocksParent: true,
		source: null,
		scope: 'h:house0000000001',
		color: null,
		charm: null,
		kind: 'task',
		assignee: null,
		assignedAt: null,
		pinnedComment: null,
		completedAt: null,
		created: '2026-10-02 10:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z'
	};
}

const keysIn = (root: ParentNode): string[] =>
	[...root.querySelectorAll<HTMLElement>('[data-ticket-option]')].map(
		(element) => element.dataset.ticketOption ?? ''
	);

describe('the detail and "Neues Ticket" in one order', () => {
	it('shows the fields of a ticket of the household in the order of the registry', async () => {
		const item = householdTicket();
		const data = {
			get: vi.fn(async () => item),
			update: vi.fn(),
			create: vi.fn(),
			delete: vi.fn()
		} satisfies TicketDetailData;
		const list = {
			find: () => null,
			upsert: vi.fn((summary: TicketSummary) => summary),
			completed: vi.fn(),
			remove: vi.fn(),
			announce: vi.fn()
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, SESSION, list);
		store.open(item.id);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const catalog = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			SESSION
		);
		void catalog.load();
		const { container, unmount } = render(TicketFields, {
			props: {
				store,
				catalog,
				ticket: item,
				assignees: fixedAssignees(MEMBERS, ME)
			}
		});
		await tick();
		const shown = keysIn(container);
		const registryOrder = TICKET_OPTIONS.map((option) => option.key).filter((key) =>
			shown.includes(key)
		);
		expect(shown).toEqual(registryOrder);
		expect(shown).toEqual([
			'status',
			'priority',
			'assignee',
			'due',
			'project',
			'color',
			'charm',
			'kind',
			'tags'
		]);
		unmount();
	});

	it('offers every option of the registry in "Neues Ticket" at its place, and no exception', async () => {
		localStorage.setItem(MORE_OPTIONS_KEY, '1');
		const { container } = render(NewTicketForm, {
			props: {
				repeat: true,
				statusAvailable: true,
				subtasksAvailable: true,
				colorsAvailable: true,
				charmsAvailable: true,
				assignmentAvailable: true,
				assignees: fixedAssignees(MEMBERS, ME),
				extrasAvailable: true,
				kindAvailable: true,
				pinAvailable: true,
				dayPlanAvailable: true,
				ticketSourcesAvailable: true,
				picker: fakePickerSource().source,
				scope: 'h:house0000000001',
				today: '2026-10-06',
				oncreate: vi.fn(),
				oncreated: vi.fn(),
				oncancel: vi.fn()
			}
		});
		await tick();
		const more = container.querySelector<HTMLElement>('[data-more-options]');
		expect(more).not.toBeNull();
		const inMore = keysIn(more as HTMLElement);
		const main = keysIn(container).filter((key) => !inMore.includes(key));
		// The main fields keep the order of the dialog of before; "Weitere Optionen" follows the detail.
		expect([...main].sort()).toEqual(createKeys('main').sort());
		expect(inMore).toEqual(createKeys('more'));
		for (const option of TICKET_OPTIONS.filter((entry) => entry.create === null)) {
			expect(keysIn(container), option.key).not.toContain(option.key);
		}
		localStorage.removeItem(MORE_OPTIONS_KEY);
	});
});
