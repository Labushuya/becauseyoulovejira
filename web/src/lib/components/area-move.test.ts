// "In den Haushalt verschieben …" and "Ins Private verschieben …" (E7-4, ADR-0061): the entry of the
// menu of a ticket only for an account in a household and with the right (own private records into
// the household; records of the household into the private area for the creator, "move_out" and the
// owner), the entry of the bulk action only when every chosen ticket may move, and the dialog with the
// preview of the server: what moves, the hint for the household, the choices it needs, "Mitnehmen"
// with a new preview, the move with the choices, a refusal in the dialog. Since MV-2 "Ganze Serie
// verschieben" for a ticket of a series and a rule, with "Bisherige erledigte Vorkommen mitnehmen".
// Real stores on fake data.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveAnswer } from '$lib/data/area-move';
import type { MovePreview } from '$lib/domain/area-move';
import type { HouseholdRight, HouseholdState } from '$lib/domain/household';
import { pb } from '$lib/pocketbase';
import { AreaMoveStore, type AreaMoveData } from '$lib/stores/area-move.svelte';
import { AreaStore } from '$lib/stores/area.svelte';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';
import { HouseholdStore, type HouseholdData } from '$lib/stores/household.svelte';
import AreaMoveHarness from '$lib/test/AreaMoveHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ME = 'user00000000001';
const OTHER = 'user00000000002';
const HOUSE = { id: 'house0000000001', name: 'Haus Beispiel' };
const SESSION = { ensureValid: () => true, logout: vi.fn() };

beforeEach(() => {
	pb.authStore.save('test-token', {
		id: ME,
		collectionId: '_pb_users_auth_',
		collectionName: 'users'
	} as never);
});

afterEach(() => {
	pb.authStore.clear();
});

function householdState(role: 'owner' | 'member', rights: HouseholdRight[]): HouseholdState {
	return {
		household: { ...HOUSE, created: '', trashRetention: '30' },
		me: { member: 'member00000001', role, rights },
		members: [],
		invites: null
	};
}

/** A preview of the server as the data layer reads it. */
function preview(overrides: Partial<MovePreview> = {}): MovePreview {
	return {
		preview: true,
		kind: 'ticket',
		to: 'household',
		scope: `h:${HOUSE.id}`,
		fromName: 'Privat',
		toName: HOUSE.name,
		counts: {
			tickets: 2,
			subtasks: 1,
			projects: 0,
			rules: 0,
			items: 0,
			comments: 3,
			dependencies: 0,
			ticketSources: 0,
			series: 0,
			occurrences: { open: 0, done: 0 }
		},
		seriesOffer: { rules: 0, open: 0, done: 0 },
		conflicts: {
			project: {
				projects: [{ id: 'proj00000000001', code: 'PRIV', name: 'Privates' }],
				tickets: 2,
				rules: 0,
				targets: [{ id: 'proj00000000002', code: 'HAUS', name: 'Haus' }]
			},
			tags: { reused: [], created: ['garten'] },
			dependencies: [
				{
					ticket: { id: 'tick00000000001', key: 'PRIV-1', title: 'Eins' },
					other: { id: 'tick00000000009', key: 'PRIV-9', title: 'Neun' }
				}
			],
			ticketSources: [],
			parents: [],
			projectParents: [],
			codes: [],
			series: [],
			ruleTickets: 0,
			rulesProject: [],
			items: { connection: 0, target: 0, duplicate: 0 },
			targets: 0,
			unitTargets: 0
		},
		needs: { project: true, dependencies: true, ticketSources: false, codes: [] },
		moved: null,
		...overrides
	};
}

interface Setup {
	area?: 'private' | 'household';
	role?: 'owner' | 'member';
	rights?: HouseholdRight[];
	inHousehold?: boolean;
	owner?: string;
	/** The ticket of the menu belongs to a series (MV-2). */
	recurring?: boolean;
	bulkOwners?: string[];
	move?: AreaMoveData['move'];
}

async function setup(options: Setup = {}) {
	const household = new HouseholdStore(
		{
			fetch: async () => ({
				kind: 'ok' as const,
				value:
					options.inHousehold === false
						? null
						: householdState(options.role ?? 'member', options.rights ?? [])
			})
		} as unknown as HouseholdData,
		SESSION
	);
	await household.load();
	const memory = new Map<string, string>();
	const area = new AreaStore(
		() => ({
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value)
		}),
		() => undefined
	);
	area.begin(ME);
	area.followHousehold(options.inHousehold === false ? null : HOUSE);
	if (options.area === 'household') area.select('household');
	const shown: FlagInput[] = [];
	const flags: FlagSink = {
		show: (input) => {
			shown.push(input);
			return 'flag';
		},
		dismiss: () => undefined
	};
	const move = vi.fn(
		options.move ??
			(async (body: Record<string, unknown>): Promise<MoveAnswer<MovePreview>> => ({
				kind: 'ok',
				value:
					body.preview === true
						? preview(
								body.dependencies === 'take'
									? {
											counts: {
												tickets: 3,
												subtasks: 1,
												projects: 0,
												rules: 0,
												items: 0,
												comments: 3,
												dependencies: 1,
												ticketSources: 0,
												series: 0,
												occurrences: { open: 0, done: 0 }
											}
										}
									: {}
							)
						: preview({
								preview: false,
								moved: {
									tickets: [{ id: 'tick00000000001', key: 'TASK-7', previous: 'PRIV-1' }],
									projects: [],
									rules: [],
									items: []
								}
							})
			}))
	);
	const moved = vi.fn();
	const moves = new AreaMoveStore({ move }, SESSION, flags, moved);
	const ticket = {
		id: 'tick00000000001',
		key: 'PRIV-1',
		owner: options.owner ?? ME,
		recurring: options.recurring === true
	};
	const bulk =
		options.bulkOwners === undefined
			? null
			: {
					kind: 'ticket' as const,
					records: options.bulkOwners.map((owner, index) => ({
						id: `tick0000000000${index}`,
						owner
					})),
					label: `${options.bulkOwners.length} Tickets`
				};
	render(AreaMoveHarness, { props: { area, household, moves, ticket, bulk } });
	await tick();
	return { move, moved, flags: shown, moves };
}

function menuEntries(): string[] {
	const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
	if (menu === null) throw new Error('no menu');
	return within(menu)
		.getAllByRole('menuitem', { hidden: true })
		.map((item) => item.textContent?.trim() ?? '');
}

async function choose(entry: string) {
	const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	await fireEvent.click(trigger);
	await fireEvent.click(menu.getByRole('menuitem', { name: entry, hidden: true }));
	await tick();
}

describe('the entry of the menu of a ticket (ADR-0061 §4)', () => {
	it('is missing without a household', async () => {
		await setup({ inHousehold: false });
		expect(menuEntries()).not.toContain('In den Haushalt verschieben …');
		expect(menuEntries()).not.toContain('Ins Private verschieben …');
	});

	it('offers an own private ticket into the household', async () => {
		await setup({ area: 'private' });
		expect(menuEntries()).toEqual([
			'Link kopieren',
			'In den Haushalt verschieben …',
			'In den Papierkorb …'
		]);
	});

	it('offers a ticket of the household into the private area to its creator only', async () => {
		await setup({ area: 'household', owner: ME });
		expect(menuEntries()).toContain('Ins Private verschieben …');
	});

	it('leaves it out for a ticket of another member without "move_out"', async () => {
		await setup({ area: 'household', owner: OTHER });
		expect(menuEntries()).not.toContain('Ins Private verschieben …');
	});

	it('offers it with "move_out" and to the owner', async () => {
		await setup({ area: 'household', owner: OTHER, rights: ['move_out'] });
		expect(menuEntries()).toContain('Ins Private verschieben …');
	});

	it('offers it to the owner of the household', async () => {
		await setup({ area: 'household', owner: OTHER, role: 'owner' });
		expect(menuEntries()).toContain('Ins Private verschieben …');
	});
});

describe('the entry of the bulk action', () => {
	it('appears only when every chosen ticket may move', async () => {
		await setup({ area: 'household', bulkOwners: [ME, ME] });
		expect(screen.getByTestId('bulk').textContent).toBe('Ins Private verschieben …');
	});

	it('is missing when one chosen ticket may not move', async () => {
		await setup({ area: 'household', bulkOwners: [ME, OTHER] });
		expect(screen.getByTestId('bulk').textContent).toBe('kein Eintrag');
	});
});

describe('the dialog of a move (ADR-0061 §1, §2)', () => {
	it('shows the preview with the hint for the household, and moves only with the choices', async () => {
		const { move, moved, flags } = await setup({ area: 'private' });
		await choose('In den Haushalt verschieben …');
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'PRIV-1 in den Haushalt verschieben' })
		);
		expect(
			within(dialog).getByText('Kommentare und Verlauf werden für alle Mitglieder sichtbar.')
		).toBeTruthy();
		await vi.waitFor(() =>
			expect(within(dialog).getByText('2 Tickets (davon 1 Unteraufgabe)')).toBeTruthy()
		);
		expect(within(dialog).getByText('3 Kommentare')).toBeTruthy();
		expect(within(dialog).getByText('Tags im Ziel neu angelegt: garten')).toBeTruthy();
		expect(move).toHaveBeenCalledTimes(1);
		// A ticket always asks with whole series (MV-2); without one the server takes nothing more.
		expect(move.mock.calls[0]?.[0]).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			preview: true,
			series: true,
			series_done: true
		});
		expect(within(dialog).queryByRole('checkbox', { name: /Serie/ })).toBeNull();

		// Without the choices nothing moves; the fields say what is missing.
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		const project = within(dialog).getByLabelText('Projekt im Ziel');
		expect(project.getAttribute('aria-invalid')).toBe('true');
		expect(move).toHaveBeenCalledTimes(1);

		await fireEvent.change(project, { target: { value: '' } });
		// "Mitnehmen" asks the server again: more tickets come along.
		await fireEvent.click(
			within(dialog).getByRole('radio', { name: 'Mitnehmen: die verknüpften Tickets kommen mit' })
		);
		await vi.waitFor(() =>
			expect(within(dialog).getByText('3 Tickets (davon 1 Unteraufgabe)')).toBeTruthy()
		);
		expect(move.mock.calls[1]?.[0]).toMatchObject({
			preview: true,
			project: '',
			dependencies: 'take'
		});

		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(3));
		expect(move.mock.calls[2]?.[0]).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			project: '',
			dependencies: 'take',
			series: true,
			series_done: true
		});
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(flags).toEqual([
			{
				tone: 'success',
				title: 'PRIV-1 in den Haushalt verschoben.',
				description: 'Neuer Key: TASK-7.'
			}
		]);
		expect(moved).toHaveBeenCalledTimes(1);
	});

	it('asks what happens to source and follow-up tickets that stay behind (QT-1, ADR-0067)', async () => {
		const crossing = preview({
			conflicts: {
				...preview().conflicts,
				project: null,
				dependencies: [],
				ticketSources: [
					{
						ticket: { id: 'tick00000000001', key: 'PRIV-1', title: 'Eins' },
						other: { id: 'tick00000000005', key: 'PRIV-5', title: 'Heizung prüfen' },
						relation: 'source',
						trashed: false
					}
				]
			},
			needs: { project: false, dependencies: false, ticketSources: true, codes: [] }
		});
		const { move } = await setup({
			area: 'private',
			move: async (body) => ({
				kind: 'ok',
				value:
					body.preview === true
						? crossing
						: {
								...crossing,
								preview: false,
								moved: { tickets: [], projects: [], rules: [], items: [] }
							}
			})
		});
		await choose('In den Haushalt verschieben …');
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'PRIV-1 in den Haushalt verschieben' })
		);
		const group = await vi.waitFor(() =>
			within(dialog).getByRole('radiogroup', {
				name: 'Quell- und Folge-Tickets, die zurückbleiben'
			})
		);
		expect(within(group).getByText('PRIV-1 stammt aus PRIV-5 „Heizung prüfen“')).toBeTruthy();
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		expect(group.getAttribute('aria-invalid')).toBe('true');
		expect(move).toHaveBeenCalledTimes(1);

		await fireEvent.click(
			within(group).getByRole('radio', {
				name: 'Verknüpfung lösen: die Tickets bleiben, der Verlauf beider vermerkt es'
			})
		);
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(2));
		expect(move.mock.calls[1]?.[0]).toMatchObject({ preview: true, ticket_sources: 'release' });
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(3));
		expect(move.mock.calls[2]?.[0]).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			ticket_sources: 'release',
			series: true,
			series_done: true
		});
	});

	it('says that the entry disappears for the others when it goes into the private area', async () => {
		await setup({
			area: 'household',
			move: async () => ({
				kind: 'ok',
				value: preview({
					to: 'private',
					conflicts: { ...preview().conflicts, project: null, dependencies: [] }
				})
			})
		});
		await choose('Ins Private verschieben …');
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'PRIV-1 ins Private verschieben' })
		);
		expect(
			within(dialog).getByText('Für die anderen Mitglieder verschwindet der Eintrag.')
		).toBeTruthy();
		expect(within(dialog).queryByLabelText('Projekt im Ziel')).toBeNull();
	});

	it('shows a refusal of the server in the dialog and moves nothing', async () => {
		const { moves } = await setup({
			area: 'household',
			owner: ME,
			move: async () => ({ kind: 'invalid', problem: 'right', params: { label: 'HAUS-2' } })
		});
		await choose('Ins Private verschieben …');
		const dialog = await vi.waitFor(() => screen.getByRole('dialog'));
		await vi.waitFor(() =>
			expect(within(dialog).getByRole('alert').textContent).toMatch(/Dafür fehlt dir das Recht/)
		);
		expect(
			within(dialog)
				.getByRole('button', { name: 'Ins Private verschieben' })
				.getAttribute('aria-disabled')
		).toBe('true');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		expect(moves.request).toBeNull();
	});
});

describe('whole series (MV-2)', () => {
	const RULE = 'rule00000000001';

	/** The preview of a series with one open and twelve done occurrences, as the body chose. */
	function seriesPreview(body: Record<string, unknown>): MovePreview {
		const rule = body.kind === 'rule';
		const whole = body.series === true;
		const done = whole && body.series_done === true;
		const tickets = whole ? (done ? 13 : 1) : rule ? 0 : 1;
		return preview({
			kind: rule ? 'rule' : 'ticket',
			preview: body.preview === true,
			counts: {
				tickets,
				subtasks: 0,
				projects: 0,
				rules: whole || rule ? 1 : 0,
				items: 0,
				comments: 0,
				dependencies: 0,
				ticketSources: 0,
				series: whole ? 1 : 0,
				occurrences: { open: whole ? 1 : 0, done: done ? 12 : 0 }
			},
			seriesOffer: { rules: 1, open: 1, done: 12 },
			conflicts: {
				...preview().conflicts,
				project: null,
				dependencies: [],
				tags: { reused: [], created: [] },
				series: whole || rule ? [] : [{ id: 'tick00000000001', key: 'PRIV-1' }],
				ruleTickets: whole ? (done ? 0 : 12) : rule ? 13 : 0
			},
			needs: { project: false, dependencies: false, ticketSources: false, codes: [] },
			moved:
				body.preview === true
					? null
					: { tickets: [], projects: [], rules: whole || rule ? [RULE] : [], items: [] }
		});
	}

	const answer = async (body: Record<string, unknown>): Promise<MoveAnswer<MovePreview>> => ({
		kind: 'ok',
		value: seriesPreview(body)
	});

	it('offers "Ganze Serie verschieben" for a ticket of a series, both chosen, counted apart', async () => {
		const { move } = await setup({ area: 'private', recurring: true, move: answer });
		await choose('In den Haushalt verschieben …');
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'PRIV-1 in den Haushalt verschieben' })
		);
		const whole = await vi.waitFor(() =>
			within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Ganze Serie verschieben' })
		);
		const done = within(dialog).getByRole<HTMLInputElement>('checkbox', {
			name: 'Bisherige erledigte Vorkommen mitnehmen (12)'
		});
		expect([whole.checked, done.checked]).toEqual([true, true]);
		expect(whole.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(whole.getAttribute('aria-describedby') ?? '')?.textContent
		).toMatch(/Die Regel mit ihrer Vorlage und das offene Vorkommen/);
		for (const line of [
			'13 Tickets',
			'1 Serie mit Regel und Vorlage',
			'1 offenes Vorkommen',
			'12 erledigte Vorkommen',
			'Die Serie läuft im Ziel weiter; ihr nächstes Ticket entsteht dort.'
		]) {
			expect(within(dialog).getByText(line)).toBeTruthy();
		}

		// Without the done ones they stay where they are, without the rule.
		await fireEvent.click(done);
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText(
					'12 bisherige Tickets der Wiederholung bleiben, wo sie sind, ohne Bezug zur Regel. Künftige Tickets entstehen im Ziel.'
				)
			).toBeTruthy()
		);
		expect(move.mock.calls[1]?.[0]).toMatchObject({
			preview: true,
			series: true,
			series_done: false
		});

		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(3));
		expect(move.mock.calls[2]?.[0]).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			series: true,
			series_done: false
		});
	});

	it('moves only the ticket without the choice: it leaves its series', async () => {
		const { move } = await setup({ area: 'private', recurring: true, move: answer });
		await choose('In den Haushalt verschieben …');
		const dialog = await vi.waitFor(() => screen.getByRole('dialog'));
		const whole = await vi.waitFor(() =>
			within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Ganze Serie verschieben' })
		);
		await fireEvent.click(whole);
		await vi.waitFor(() =>
			expect(within(dialog).getByText('PRIV-1 verlässt seine Wiederholung.')).toBeTruthy()
		);
		expect(whole.checked).toBe(false);
		expect(within(dialog).queryByRole('checkbox', { name: /erledigte Vorkommen/ })).toBeNull();
		expect(within(dialog).queryByText('1 Serie mit Regel und Vorlage')).toBeNull();
		expect(move.mock.calls[1]?.[0]).toMatchObject({
			preview: true,
			series: false,
			series_done: false
		});
	});

	it('offers it for a rule; without it the rule moves alone', async () => {
		const { move, moves } = await setup({ area: 'private', move: answer });
		moves.open({
			kind: 'rule',
			ids: [RULE],
			to: 'household',
			label: 'Wiederholung „Müll“',
			series: 'whole'
		});
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: 'Wiederholung „Müll“ in den Haushalt verschieben' })
		);
		const whole = await vi.waitFor(() =>
			within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Ganze Serie verschieben' })
		);
		expect(whole.checked).toBe(true);
		expect(move.mock.calls[0]?.[0]).toEqual({
			kind: 'rule',
			ids: [RULE],
			to: 'household',
			preview: true,
			series: true,
			series_done: true
		});
		await fireEvent.click(whole);
		await vi.waitFor(() => expect(within(dialog).getByText('1 Wiederholung')).toBeTruthy());
		expect(
			within(dialog).getByText(
				'13 bisherige Tickets der Wiederholung bleiben, wo sie sind, ohne Bezug zur Regel. Künftige Tickets entstehen im Ziel.'
			)
		).toBeTruthy();
	});

	it('asks nothing about series for a project', async () => {
		const { move, moves } = await setup({ area: 'private', move: answer });
		moves.open({
			kind: 'project',
			ids: ['proj00000000001'],
			to: 'household',
			label: 'Projekt „Haus“'
		});
		const dialog = await vi.waitFor(() => screen.getByRole('dialog'));
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(1));
		expect(move.mock.calls[0]?.[0]).not.toHaveProperty('series');
		expect(within(dialog).queryByRole('checkbox', { name: /Serie/ })).toBeNull();
	});
});
