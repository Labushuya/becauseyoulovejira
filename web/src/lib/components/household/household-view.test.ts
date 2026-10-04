// Page "Einstellungen → Haushalt" (ADR-0058, E7-2): without a household "Haushalt gründen" and "Mit
// Code beitreten" (the code grouped while typed, one neutral text for a refused code, the hint to
// wait after too many attempts); with one the name, the members with role and rights, the menu
// "•••" with exactly the actions the account may take, the rights dialog with only own rights,
// the codes shown once and revoked, and leaving, removing and handing on after a question. What
// the server would refuse is left out. Real HouseholdStore on a fake data layer; jsdom has no
// showModal(), the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type {
	HouseholdMember,
	HouseholdRight,
	HouseholdState,
	InviteGrant
} from '$lib/domain/household';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';
import {
	HouseholdStore,
	type HouseholdData,
	type HouseholdNotice
} from '$lib/stores/household.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import HouseholdView from './HouseholdView.svelte';

useOverlayStubs();

const ALL: HouseholdRight[] = ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'];
const CHRIS: HouseholdMember = {
	id: 'member00000001',
	user: 'user0000000001',
	name: 'Chris Beispiel',
	role: 'owner',
	rights: ALL,
	self: false
};
const ANNA: HouseholdMember = {
	id: 'member00000002',
	user: 'user0000000002',
	name: 'Anna Beispiel',
	role: 'member',
	rights: [],
	self: false
};
const BERT: HouseholdMember = {
	id: 'member00000003',
	user: 'user0000000003',
	name: '',
	role: 'member',
	rights: ['rename'],
	self: false
};
const CODE = 'ABCD-EFGH';

/** The state as `who` sees it. */
function stateFor(
	who: HouseholdMember,
	members: HouseholdMember[] = [CHRIS, ANNA, BERT]
): HouseholdState {
	return {
		household: { id: 'house000000001', name: 'Haus Beispiel', created: '2026-10-04 08:00:00.000Z' },
		me: { member: who.id, role: who.role, rights: who.rights },
		members: members.map((member) => ({ ...member, self: member.id === who.id })),
		invites: who.rights.includes('invite')
			? [
					{
						id: 'invite00000001',
						status: 'open',
						created: '2026-10-04 08:00:00.000Z',
						expires: '2026-10-11 08:00:00.000Z',
						ended: '',
						createdBy: 'Chris Beispiel',
						usedBy: ''
					},
					{
						id: 'invite00000002',
						status: 'used',
						created: '2026-10-03 08:00:00.000Z',
						expires: '2026-10-10 08:00:00.000Z',
						ended: '2026-10-03 09:00:00.000Z',
						createdBy: 'Chris Beispiel',
						usedBy: 'Anna Beispiel'
					}
				]
			: null
	};
}

async function show(initial: HouseholdState | null, overrides: Partial<HouseholdData> = {}) {
	const ok = <T>(value: T) => ({ kind: 'ok' as const, value });
	const data: HouseholdData = {
		fetch: vi.fn(async () => ok(initial)),
		found: vi.fn(async (name: string) =>
			ok({ ...stateFor(CHRIS, [CHRIS]), household: { id: 'house000000002', name, created: '' } })
		),
		rename: vi.fn(async (name: string) =>
			ok({
				...(initial as HouseholdState),
				household: { ...(initial as HouseholdState).household, name }
			})
		),
		invite: vi.fn(async (): Promise<{ kind: 'ok'; value: InviteGrant }> =>
			ok({ code: CODE, invite: 'invite00000001', state: initial as HouseholdState })
		),
		revoke: vi.fn(async () => ok(initial)),
		join: vi.fn(async () => ok(stateFor(ANNA))),
		setRights: vi.fn(async () => ok(initial)),
		remove: vi.fn(async () => ok(initial)),
		transfer: vi.fn(async () => ok(initial)),
		leave: vi.fn(async () => ok(null)),
		...overrides
	};
	const shown: FlagInput[] = [];
	const flags: FlagSink = {
		show: (input) => {
			shown.push(input);
			return 'flag';
		},
		dismiss: () => undefined
	};
	const notices: HouseholdNotice[] = [];
	const store = new HouseholdStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		flags,
		(notice) => notices.push(notice)
	);
	await store.load();
	render(HouseholdView, { props: { store } });
	await tick();
	return { store, data, flags: shown, notices };
}

function rowOf(name: string): HTMLElement {
	const item = screen.getByText(name, { selector: '.name' }).closest('li');
	if (!item) throw new Error(`no row for ${name}`);
	return item as HTMLElement;
}

function menuEntries(name: string): string[] {
	const trigger = within(rowOf(name)).queryByRole('button', {
		name: `Weitere Aktionen für ${name}`
	});
	if (trigger === null) return [];
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	return menu
		.getAllByRole('menuitem', { hidden: true })
		.map((item) => item.textContent?.trim() ?? '');
}

async function choose(name: string, entry: string) {
	const trigger = within(rowOf(name)).getByRole('button', { name: `Weitere Aktionen für ${name}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	await fireEvent.click(trigger);
	await fireEvent.click(menu.getByRole('menuitem', { name: entry, hidden: true }));
	await tick();
}

describe('page "Haushalt" without a household', () => {
	it('offers to found one and to join with a code', async () => {
		await show(null);
		expect(screen.getByRole('region', { name: 'Haushalt gründen' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Mit Code beitreten' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Mitglieder' })).toBeNull();
		expect(duplicateIds(document.body)).toEqual([]);
		for (const name of ['Haushalt gründen', 'Mit Code beitreten']) {
			expect(danglingReferences(screen.getByRole('region', { name })), name).toEqual([]);
		}
	});

	it('checks the name at its field and founds without loading anew', async () => {
		const { data, flags, notices } = await show(null);
		await fireEvent.click(screen.getByRole('button', { name: 'Haushalt gründen' }));
		const name = screen.getByLabelText('Name des Haushalts');
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(data.found).not.toHaveBeenCalled();
		await fireEvent.input(name, { target: { value: ' Haus Beispiel ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Haushalt gründen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Haus Beispiel' })).toBeTruthy()
		);
		expect(data.found).toHaveBeenCalledWith('Haus Beispiel', expect.anything());
		expect(flags.map((flag) => flag.title)).toContain('Haushalt „Haus Beispiel“ gegründet.');
		expect(notices).toEqual([]);
	});

	it('groups the code while it is typed and joins, then loads anew with a notice', async () => {
		const { data, notices } = await show(null);
		const input = screen.getByLabelText('Einladungscode') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'abcdefgh' } });
		expect(input.value).toBe('ABCD-EFGH');
		await fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }));
		await vi.waitFor(() => expect(notices).toHaveLength(1));
		expect(data.join).toHaveBeenCalledWith('ABCD-EFGH', expect.anything());
		expect(notices[0]?.title).toBe('Du bist dem Haushalt „Haus Beispiel“ beigetreten.');
	});

	it('says the one neutral text for a refused code and the wait after too many attempts', async () => {
		const join = vi
			.fn()
			.mockResolvedValueOnce({ kind: 'invalid', problem: 'code' })
			.mockResolvedValueOnce({ kind: 'rate' });
		await show(null, { join });
		const input = screen.getByLabelText('Einladungscode');
		await fireEvent.input(input, { target: { value: 'ZZZZZZZZ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }));
		await vi.waitFor(() => expect(screen.getByText('Code ungültig oder abgelaufen.')).toBeTruthy());
		expect(input.getAttribute('aria-invalid')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }));
		await vi.waitFor(() => expect(screen.getByText(/Zu viele Versuche/)).toBeTruthy());
	});

	it('says that the page comes with the next restart before the migration', async () => {
		await show(null, { fetch: vi.fn(async () => ({ kind: 'missing' as const })) });
		expect(screen.getByText(/Der Haushalt ist nach dem nächsten Neustart verfügbar/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Haushalt gründen' })).toBeNull();
	});
});

describe('page "Haushalt" for the owner', () => {
	it('shows name, members with role and rights and the actions of the owner', async () => {
		await show(stateFor(CHRIS));
		expect(screen.getByRole('heading', { name: 'Haus Beispiel' })).toBeTruthy();
		expect(screen.getByText('Du bist Inhaber')).toBeTruthy();
		expect(within(rowOf('Chris Beispiel')).getByText('Alle Rechte')).toBeTruthy();
		expect(within(rowOf('Chris Beispiel')).getByText('(du)')).toBeTruthy();
		expect(within(rowOf('Anna Beispiel')).getByText('Keine Sonderrechte')).toBeTruthy();
		expect(within(rowOf('Konto ohne Namen')).getByText('Umbenennen')).toBeTruthy();
		expect(menuEntries('Chris Beispiel')).toEqual([]);
		expect(menuEntries('Anna Beispiel')).toEqual([
			'Rechte bearbeiten …',
			'Zum Inhaber machen …',
			'Aus dem Haushalt entfernen …'
		]);
		expect(screen.getByRole('button', { name: 'Umbenennen …' })).toBeTruthy();
		// The owner does not leave; the page says what to do instead.
		expect(screen.queryByRole('button', { name: 'Austreten …' })).toBeNull();
		expect(screen.getByText(/Übertrage zuerst die Inhaberschaft/)).toBeTruthy();
		expect(duplicateIds(document.body)).toEqual([]);
	});

	it('shows a new code once with "Kopieren" until it was handed on, and lists the codes', async () => {
		const { data } = await show(stateFor(CHRIS));
		const codes = screen.getByRole('region', { name: 'Einladungscodes' });
		expect(within(codes).getByText('Offen')).toBeTruthy();
		expect(within(codes).getByText(/benutzt am 03\.10\.2026 11:00 von Anna Beispiel/)).toBeTruthy();
		await fireEvent.click(within(codes).getByRole('button', { name: 'Neuen Code erzeugen' }));
		await vi.waitFor(() => expect(screen.getByText(CODE)).toBeTruthy());
		expect(data.invite).toHaveBeenCalledOnce();
		expect(screen.getByRole('button', { name: 'Einladungscode kopieren' })).toBeTruthy();
		expect(screen.getByText(/Der Code wird nur jetzt angezeigt/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Weitergegeben' }));
		expect(screen.queryByText(CODE)).toBeNull();
		// Each button names its code, so several open codes stay apart.
		const revoke = within(codes).getByRole('button', {
			name: 'Code, gültig bis 11.10.2026 10:00, widerrufen'
		});
		expect(revoke.textContent?.trim()).toBe('Widerrufen');
		await fireEvent.click(revoke);
		await vi.waitFor(() =>
			expect(data.revoke).toHaveBeenCalledWith('invite00000001', expect.anything())
		);
	});

	it('removes and hands on only after a question', async () => {
		const { data, flags } = await show(stateFor(CHRIS));
		await choose('Anna Beispiel', 'Aus dem Haushalt entfernen …');
		const remove = screen.getByRole('dialog', {
			name: 'Anna Beispiel aus dem Haushalt entfernen?'
		});
		expect(within(remove).getByText(/verliert sofort den Zugriff/)).toBeTruthy();
		await fireEvent.click(within(remove).getByRole('button', { name: 'Entfernen' }));
		await vi.waitFor(() => expect(data.remove).toHaveBeenCalledWith(ANNA.id, expect.anything()));
		await vi.waitFor(() =>
			expect(flags.map((flag) => flag.title)).toContain('Anna Beispiel ist nicht mehr im Haushalt.')
		);

		await choose('Anna Beispiel', 'Zum Inhaber machen …');
		const transfer = screen.getByRole('dialog', { name: 'Anna Beispiel zum Inhaber machen?' });
		expect(within(transfer).getByText(/behältst alle Rechte/)).toBeTruthy();
		await fireEvent.click(within(transfer).getByRole('button', { name: 'Abbrechen' }));
		expect(data.transfer).not.toHaveBeenCalled();
	});

	it('renames inline and shows a refusal of the server on the page', async () => {
		const { data } = await show(stateFor(CHRIS), {
			setRights: vi.fn(async () => ({ kind: 'invalid' as const, problem: 'rights-foreign' }))
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Umbenennen …' }));
		const name = screen.getByLabelText('Neuer Name') as HTMLInputElement;
		expect(name.value).toBe('Haus Beispiel');
		await fireEvent.input(name, { target: { value: 'Neues Haus' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Neues Haus' })).toBeTruthy()
		);
		expect(data.rename).toHaveBeenCalledWith('Neues Haus', expect.anything());

		await choose('Anna Beispiel', 'Rechte bearbeiten …');
		const dialog = screen.getByRole('dialog', { name: 'Rechte von Anna Beispiel' });
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: /Einladen/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(
				screen.getByText('Du kannst nur Rechte vergeben oder entziehen, die du selbst hast.')
			).toBeTruthy()
		);
	});
});

describe('page "Haushalt" for a member', () => {
	it('offers no action of a right the member lacks, but "Austreten" after a question', async () => {
		const { data, notices } = await show(stateFor(ANNA));
		expect(screen.getByText('Du bist Mitglied')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Umbenennen …' })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Einladungscodes' })).toBeNull();
		for (const name of ['Chris Beispiel', 'Konto ohne Namen'])
			expect(menuEntries(name)).toEqual([]);

		await fireEvent.click(screen.getByRole('button', { name: 'Austreten …' }));
		const dialog = screen.getByRole('dialog', {
			name: 'Aus dem Haushalt „Haus Beispiel“ austreten?'
		});
		expect(
			within(dialog).getByText(
				'Deine Einträge im Haushalt bleiben dort, und du verlierst sofort den Zugriff auf alle Einträge des Haushalts.'
			)
		).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Austreten' }));
		await vi.waitFor(() => expect(notices).toHaveLength(1));
		expect(data.leave).toHaveBeenCalledOnce();
		expect(notices[0]).toEqual({
			title: 'Du bist aus dem Haushalt „Haus Beispiel“ ausgetreten.',
			text: 'Deine Einträge im Haushalt bleiben dort.'
		});
	});

	it('lets a member with "delegate" change only own rights of others, never of the owner', async () => {
		const delegate: HouseholdMember = { ...ANNA, rights: ['invite', 'delegate'] };
		const { data } = await show(stateFor(delegate, [CHRIS, delegate, BERT]));
		expect(menuEntries('Chris Beispiel')).toEqual([]);
		expect(menuEntries('Konto ohne Namen')).toEqual(['Rechte bearbeiten …']);
		await choose('Konto ohne Namen', 'Rechte bearbeiten …');
		const dialog = screen.getByRole('dialog', { name: 'Rechte von Konto ohne Namen' });
		expect(
			within(dialog)
				.getAllByRole('checkbox')
				.map((box) => box.closest('label')?.querySelector('.name')?.textContent)
		).toEqual(['Einladen', 'Rechte weitergeben']);
		expect(within(dialog).getByText(/die du nicht ändern kannst: Umbenennen\./)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: /Einladen/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(data.setRights).toHaveBeenCalledWith(BERT.id, ['invite', 'rename'], expect.anything())
		);
	});
});
