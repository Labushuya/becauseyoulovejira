// "Haushalt auflösen …" on the page "Einstellungen → Haushalt" (E7-4, ADR-0061 §5): only the owner
// gets the section; the dialog shows the preview of the server (what the household holds, its
// members, the codes that get a suffix), takes everything into the private area or deletes it for
// good only with the name typed, and a refusal stands in the dialog. Afterwards the household is gone
// and the store says so. The other members hear it from the server (byl/household with `dissolved`).
// Real HouseholdStore on a fake data layer; jsdom has no showModal(), the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { HouseholdChange } from '$lib/data/household';
import type { DissolvePreview } from '$lib/domain/area-move';
import type { HouseholdState } from '$lib/domain/household';
import {
	HouseholdStore,
	type HouseholdData,
	type HouseholdLive,
	type HouseholdNotice
} from '$lib/stores/household.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import HouseholdView from './HouseholdView.svelte';

useOverlayStubs();

const NAME = 'Haus Beispiel';

function stateAs(role: 'owner' | 'member'): HouseholdState {
	return {
		household: { id: 'house000000001', name: NAME, created: '', trashRetention: '30' },
		me: { member: 'member00000001', role, rights: [] },
		members: [
			{
				id: 'member00000001',
				user: 'user0000000001',
				name: 'Chris Beispiel',
				role,
				rights: [],
				self: true
			}
		],
		invites: null
	};
}

/** With "übernehmen" three tickets and a rotation lose their assignee in the private area (PL-2). */
function preview(
	mode: 'adopt' | 'delete',
	done = false,
	cleared = mode === 'adopt' ? { tickets: 3, rules: 1 } : { tickets: 0, rules: 0 }
): DissolvePreview {
	return {
		preview: !done,
		mode,
		household: { id: 'house000000001', name: NAME },
		members: [
			{ name: 'Chris Beispiel', role: 'owner', self: true },
			{ name: 'Anna Beispiel', role: 'member', self: false }
		],
		counts: {
			tickets: 4,
			trash: 1,
			projects: 1,
			rules: 0,
			items: 2,
			tags: 0,
			connections: 0,
			comments: 0
		},
		assigneesCleared: cleared,
		codes:
			mode === 'adopt'
				? [{ id: 'proj00000000001', code: 'HAUS', name: 'Haus', suggestion: 'HAUSH' }]
				: []
	};
}

async function setup(role: 'owner' | 'member', dissolve?: HouseholdData['dissolve']) {
	let current: HouseholdState | null = stateAs(role);
	const data = {
		fetch: vi.fn(async () => ({ kind: 'ok' as const, value: current })),
		dissolve: vi.fn(
			dissolve ??
				(async (body: { mode: 'adopt' | 'delete'; preview?: boolean }) => {
					if (body.preview !== true) current = null;
					return { kind: 'ok' as const, value: preview(body.mode, body.preview !== true) };
				})
		)
	} as unknown as HouseholdData & { dissolve: ReturnType<typeof vi.fn> };
	const notices: HouseholdNotice[] = [];
	const store = new HouseholdStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		undefined,
		(notice) => notices.push(notice)
	);
	await store.load();
	render(HouseholdView, { props: { store } });
	await tick();
	return { store, data, notices };
}

async function openDialog() {
	await fireEvent.click(screen.getByRole('button', { name: 'Haushalt auflösen …' }));
	const dialog = screen.getByRole('dialog', { name: `Haushalt „${NAME}“ auflösen` });
	await vi.waitFor(() => expect(within(dialog).getByText('4 Tickets')).toBeTruthy());
	return dialog;
}

describe('"Haushalt auflösen" on the page (ADR-0061 §5)', () => {
	it('is there only for the owner', async () => {
		await setup('member');
		expect(screen.queryByRole('button', { name: 'Haushalt auflösen …' })).toBeNull();
	});

	it('shows what the household holds, its members and the codes that get a suffix', async () => {
		const { data } = await setup('owner');
		const dialog = await openDialog();
		expect(within(dialog).getByText('1 Ticket im Papierkorb')).toBeTruthy();
		expect(within(dialog).getByText('2 Einträge im Eingang')).toBeTruthy();
		expect(within(dialog).getByText(/Anna Beispiel/)).toBeTruthy();
		expect(within(dialog).getByText('Haus: HAUS → HAUSH')).toBeTruthy();
		expect(data.dissolve).toHaveBeenCalledWith({ mode: 'adopt', preview: true }, expect.anything());
	});

	it('warns with "übernehmen" that tickets and rules lose their assignee, not with "löschen" (PL-2)', async () => {
		const { data } = await setup('owner');
		const dialog = await openDialog();
		const warning = 'Bei 3 Tickets und 1 Wiederholung fällt die Zuständigkeit weg.';
		expect(within(dialog).getByText(warning)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('radio', { name: 'Alles endgültig löschen' }));
		await vi.waitFor(() =>
			expect(data.dissolve).toHaveBeenLastCalledWith(
				{ mode: 'delete', preview: true },
				expect.anything()
			)
		);
		expect(within(dialog).queryByText(warning)).toBeNull();
	});

	it('says nothing about assignees when none is lost (PL-2)', async () => {
		await setup('owner', async (body) => ({
			kind: 'ok',
			value: preview(body.mode, false, { tickets: 0, rules: 0 })
		}));
		const dialog = await openDialog();
		expect(within(dialog).queryByText(/fällt die Zuständigkeit weg/)).toBeNull();
	});

	it('takes everything into the private area, and the household is gone', async () => {
		const { store, data, notices } = await setup('owner');
		const dialog = await openDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Auflösen und übernehmen' }));
		await vi.waitFor(() => expect(store.household).toBeNull());
		expect(data.dissolve).toHaveBeenLastCalledWith({ mode: 'adopt' }, expect.anything());
		expect(notices).toEqual([
			{
				title: `Haushalt „${NAME}“ aufgelöst.`,
				text: 'Alle Einträge sind jetzt in deinem Bereich Privat.'
			}
		]);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('deletes everything only with the name of the household typed', async () => {
		const { store, data } = await setup('owner');
		const dialog = await openDialog();
		await fireEvent.click(within(dialog).getByRole('radio', { name: 'Alles endgültig löschen' }));
		await vi.waitFor(() =>
			expect(data.dissolve).toHaveBeenLastCalledWith(
				{ mode: 'delete', preview: true },
				expect.anything()
			)
		);
		const typed = within(dialog).getByLabelText(`Zum Bestätigen den Namen „${NAME}“ eintippen`);
		await fireEvent.input(typed, { target: { value: 'Haus' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Auflösen und löschen' }));
		expect(typed.getAttribute('aria-invalid')).toBe('true');
		expect(within(dialog).getByText('Der Name stimmt nicht.')).toBeTruthy();
		expect(data.dissolve).not.toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Haus' }),
			expect.anything()
		);

		await fireEvent.input(typed, { target: { value: ` ${NAME} ` } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Auflösen und löschen' }));
		await vi.waitFor(() => expect(store.household).toBeNull());
		expect(data.dissolve).toHaveBeenLastCalledWith(
			{ mode: 'delete', name: ` ${NAME} ` },
			expect.anything()
		);
	});

	it('shows a refusal of the server in the dialog', async () => {
		await setup('owner', async (body) =>
			body.preview === true
				? { kind: 'ok', value: preview(body.mode) }
				: { kind: 'invalid', problem: 'owner-only' }
		);
		const dialog = await openDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Auflösen und übernehmen' }));
		await vi.waitFor(() =>
			expect(within(dialog).getByRole('alert').textContent).toMatch(
				/Auflösen kann nur der Inhaber des Haushalts/
			)
		);
	});
});

describe('the other members hear it (ADR-0061 §5)', () => {
	it('say that the household was dissolved instead of "nicht mehr Mitglied"', async () => {
		let answer: HouseholdState | null = stateAs('member');
		let notify: ((change?: HouseholdChange) => void) | null = null;
		const live: HouseholdLive = {
			changes: async (onChange) => {
				notify = onChange;
				return async () => undefined;
			},
			reconnected: async () => async () => undefined
		};
		const notices: HouseholdNotice[] = [];
		const store = new HouseholdStore(
			{ fetch: async () => ({ kind: 'ok' as const, value: answer }) } as unknown as HouseholdData,
			{ ensureValid: () => true, logout: vi.fn() },
			undefined,
			(notice) => notices.push(notice)
		);
		await store.load();
		const stop = store.connect(live);
		await vi.waitFor(() => expect(notify).not.toBeNull());
		answer = null;
		notify!({ dissolved: true });
		await vi.waitFor(() => expect(store.household).toBeNull());
		expect(notices).toEqual([{ title: `Der Haushalt „${NAME}“ wurde aufgelöst.` }]);
		stop();
	});
});
