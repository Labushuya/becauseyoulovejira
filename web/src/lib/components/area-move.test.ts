// "In den Haushalt verschieben …" and "Ins Private verschieben …" (E7-4, ADR-0061): the entry of the
// menu of a ticket only for an account in a household and with the right (own private records into
// the household; records of the household into the private area for the creator, "move_out" and the
// owner), the entry of the bulk action only when every chosen ticket may move, and the dialog with the
// preview of the server: what moves, the hint for the household, the choices it needs, "Mitnehmen"
// with a new preview, the move with the choices, a refusal in the dialog. Real stores on fake data.

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
			dependencies: 0
		},
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
			parents: [],
			projectParents: [],
			codes: [],
			series: [],
			ruleTickets: 0,
			rulesProject: [],
			items: { connection: 0, target: 0, duplicate: 0 },
			targets: 0
		},
		needs: { project: true, dependencies: true, codes: [] },
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
												dependencies: 1
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
	const ticket = { id: 'tick00000000001', key: 'PRIV-1', owner: options.owner ?? ME };
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
		expect(move.mock.calls[0]?.[0]).toEqual({
			kind: 'ticket',
			ids: ['tick00000000001'],
			to: 'household',
			preview: true
		});

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
			dependencies: 'take'
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
