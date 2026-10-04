// Page "Einstellungen → Konten" (ADR-0056 §3): the list with name, e-mail, right, switch and
// creation, the own account without a menu, "Konto anlegen" with checks at the fields and the start
// password shown once (code block with "Kopieren", "Weitergegeben" removes it), a reset and the
// changes of the switch and the right after a question, refusals on the page. Real AccountsStore on
// a fake data layer; jsdom has no showModal(), the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '$lib/domain/accounts';
import { AccountsStore, type AccountsData } from '$lib/stores/accounts.svelte';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import AccountsView from './AccountsView.svelte';

useOverlayStubs();

const SELF: Account = {
	id: 'user0000000001',
	name: 'Chris Beispiel',
	email: 'chris@example.com',
	admin: true,
	disabled: false,
	created: '2026-09-24 08:00:00.000Z',
	self: true
};
const ANNA: Account = {
	id: 'user0000000002',
	name: 'Anna Beispiel',
	email: 'anna@example.com',
	admin: false,
	disabled: false,
	created: '2026-10-04 08:00:00.000Z',
	self: false
};
const BERT: Account = {
	...ANNA,
	id: 'user0000000003',
	name: '',
	email: 'bert@example.com',
	disabled: true
};
const PASSWORD = 'abcd-EFGH-2345-wxyz';

async function show(overrides: Partial<AccountsData> = {}) {
	const data: AccountsData = {
		list: vi.fn(async () => ({
			kind: 'ok' as const,
			value: { accounts: [SELF, ANNA, BERT], passwordMin: 8 }
		})),
		create: vi.fn(async (input: { email: string; name: string }) => ({
			kind: 'ok' as const,
			value: { account: { ...ANNA, id: 'user0000000004', ...input }, password: PASSWORD }
		})),
		resetPassword: vi.fn(async () => ({
			kind: 'ok' as const,
			value: { account: ANNA, password: PASSWORD }
		})),
		setDisabled: vi.fn(async (id: string, disabled: boolean) => ({
			kind: 'ok' as const,
			value: { ...(id === ANNA.id ? ANNA : BERT), disabled }
		})),
		setAdmin: vi.fn(async (_id: string, admin: boolean) => ({
			kind: 'ok' as const,
			value: { ...ANNA, admin }
		})),
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
	const store = new AccountsStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	await store.load();
	render(AccountsView, { props: { store } });
	await tick();
	return { store, data, flags: shown };
}

function rowOf(name: string): HTMLElement {
	const item = screen.getByText(name, { selector: '.name' }).closest('li');
	if (!item) throw new Error(`no row for ${name}`);
	return item as HTMLElement;
}

async function choose(name: string, entry: string) {
	const trigger = within(rowOf(name)).getByRole('button', { name: `Weitere Aktionen für ${name}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	await fireEvent.click(trigger);
	await fireEvent.click(menu.getByRole('menuitem', { name: entry, hidden: true }));
	await tick();
}

describe('page "Konten": the list', () => {
	it('names every account with e-mail, right, switch and creation', async () => {
		await show();
		const anna = rowOf('Anna Beispiel');
		expect(within(anna).getByText('anna@example.com')).toBeTruthy();
		expect(within(anna).getByText(/angelegt am 04\.10\.2026/)).toBeTruthy();
		expect(within(anna).queryByText('Verwalter der App')).toBeNull();
		const self = rowOf('Chris Beispiel');
		expect(within(self).getByText('Verwalter der App')).toBeTruthy();
		expect(within(self).getByText('(du)')).toBeTruthy();
		// An account without a name shows its address once, as its name.
		const bert = rowOf('bert@example.com');
		expect(within(bert).getByText('Deaktiviert')).toBeTruthy();
	});

	it('gives the own account no menu, every other one its actions', async () => {
		await show();
		expect(
			within(rowOf('Chris Beispiel')).queryByRole('button', { name: /Weitere Aktionen/ })
		).toBeNull();
		expect(
			within(rowOf('Chris Beispiel')).getByText(/Dein Konto änderst du unter „Mein Konto“/)
		).toBeTruthy();
		const trigger = within(rowOf('Anna Beispiel')).getByRole('button', {
			name: 'Weitere Aktionen für Anna Beispiel'
		});
		const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
		expect(
			menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
		).toEqual(['Passwort zurücksetzen …', 'Deaktivieren …', 'Zum Verwalter machen …']);
		const bert = document.getElementById(
			within(rowOf('bert@example.com'))
				.getByRole('button', { name: 'Weitere Aktionen für bert@example.com' })
				.getAttribute('aria-controls') ?? ''
		)!;
		expect(within(bert).getByRole('menuitem', { name: 'Aktivieren', hidden: true })).toBeTruthy();
	});

	it('has no dangling or duplicate IDs in the list and the form', async () => {
		await show();
		for (const name of ['Konten', 'Konto anlegen']) {
			const region = screen.getByRole('region', { name });
			expect(danglingReferences(region), name).toEqual([]);
		}
		expect(duplicateIds(document.body)).toEqual([]);
	});
});

describe('page "Konten": create an account', () => {
	it('checks name and address at their fields before sending', async () => {
		const { data } = await show();
		await fireEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		const name = screen.getByLabelText('Name');
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Bitte einen Namen eingeben.')).toBeTruthy();
		await fireEvent.input(name, { target: { value: 'Dora' } });
		await fireEvent.input(screen.getByLabelText('E-Mail-Adresse'), {
			target: { value: 'dora@example' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		expect(screen.getByLabelText('E-Mail-Adresse').getAttribute('aria-invalid')).toBe('true');
		expect(data.create).not.toHaveBeenCalled();
	});

	it('shows the start password once with "Kopieren" until it was handed over', async () => {
		const { data } = await show();
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: ' Dora Beispiel ' } });
		await fireEvent.input(screen.getByLabelText('E-Mail-Adresse'), {
			target: { value: 'dora@example.com' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Konto für Dora Beispiel angelegt' })).toBeTruthy()
		);
		expect(data.create).toHaveBeenCalledWith(
			{ email: 'dora@example.com', name: 'Dora Beispiel' },
			expect.anything()
		);
		expect(screen.getByText(PASSWORD)).toBeTruthy();
		expect(
			screen.getByRole('button', { name: 'Startpasswort für Dora Beispiel kopieren' })
		).toBeTruthy();
		expect(screen.getByText(/Das Passwort steht nur jetzt hier/)).toBeTruthy();
		await vi.waitFor(() =>
			expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Weitergegeben' }));
		expect(screen.queryByText(PASSWORD)).toBeNull();
		expect(document.activeElement?.textContent).toBe('Konten');
	});

	it('names a taken address at its field', async () => {
		await show({
			create: vi.fn(async () => ({ kind: 'invalid' as const, problem: 'email-taken' }))
		});
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Anna' } });
		await fireEvent.input(screen.getByLabelText('E-Mail-Adresse'), {
			target: { value: 'anna@example.com' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		await vi.waitFor(() =>
			expect(screen.getByText('Für diese E-Mail-Adresse gibt es schon ein Konto.')).toBeTruthy()
		);
		expect(screen.getByLabelText('E-Mail-Adresse').getAttribute('aria-invalid')).toBe('true');
	});
});

describe('page "Konten": changes of an account', () => {
	it('resets a password after a question and shows the new one once', async () => {
		const { data } = await show();
		await choose('Anna Beispiel', 'Passwort zurücksetzen …');
		const dialog = screen.getByRole('dialog', { name: 'Passwort von Anna Beispiel zurücksetzen?' });
		expect(within(dialog).getByText(/alle Anmeldungen dieses Kontos enden sofort/)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Neues Passwort erzeugen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Neues Passwort für Anna Beispiel' })).toBeTruthy()
		);
		expect(data.resetPassword).toHaveBeenCalledWith(ANNA.id, expect.anything());
		expect(screen.getByText(PASSWORD)).toBeTruthy();
	});

	it('disables after a question, enables at once, both with a flag', async () => {
		const { data, flags } = await show();
		await choose('Anna Beispiel', 'Deaktivieren …');
		const dialog = screen.getByRole('dialog', { name: 'Anna Beispiel deaktivieren?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Deaktivieren' }));
		await vi.waitFor(() =>
			expect(data.setDisabled).toHaveBeenCalledWith(ANNA.id, true, expect.anything())
		);
		await vi.waitFor(() =>
			expect(flags.map((flag) => flag.title)).toContain('Anna Beispiel ist deaktiviert.')
		);
		await choose('bert@example.com', 'Aktivieren');
		await vi.waitFor(() =>
			expect(data.setDisabled).toHaveBeenCalledWith(BERT.id, false, expect.anything())
		);
		expect(flags.map((flag) => flag.title)).toContain('bert@example.com ist wieder aktiv.');
	});

	it('gives the right after a question', async () => {
		const { data, flags } = await show();
		await choose('Anna Beispiel', 'Zum Verwalter machen …');
		const dialog = screen.getByRole('dialog', { name: 'Anna Beispiel zum Verwalter machen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zum Verwalter machen' }));
		await vi.waitFor(() =>
			expect(data.setAdmin).toHaveBeenCalledWith(ANNA.id, true, expect.anything())
		);
		await vi.waitFor(() =>
			expect(flags.map((flag) => flag.title)).toContain(
				'Anna Beispiel ist jetzt Verwalter der App.'
			)
		);
	});

	it('shows a refusal of the server on the page', async () => {
		await show({
			setAdmin: vi.fn(async () => ({ kind: 'invalid' as const, problem: 'last-admin' }))
		});
		await choose('Anna Beispiel', 'Zum Verwalter machen …');
		const dialog = screen.getByRole('dialog', { name: 'Anna Beispiel zum Verwalter machen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zum Verwalter machen' }));
		await vi.waitFor(() =>
			expect(screen.getByText(/Mindestens ein aktives Konto muss Verwalter bleiben/)).toBeTruthy()
		);
	});
});

describe('page "Konten": households without an active owner (E7-4, ADR-0061 §6)', () => {
	const OWNER: Account = { ...BERT, owns: { id: 'house000000001', name: 'Wohnung' } };
	const HOUSEHOLD = {
		id: 'house000000001',
		name: 'Wohnung',
		owner: { id: BERT.id, name: '' },
		members: [
			{ id: 'member00000002', user: ANNA.id, name: 'Anna Beispiel', disabled: false },
			{ id: 'member00000003', user: 'user0000000009', name: 'Sina Beispiel', disabled: true }
		]
	};

	it('names the household an account owns and warns before disabling its owner', async () => {
		const owner: Account = { ...ANNA, owns: { id: 'house000000002', name: 'Haus' } };
		await show({
			list: vi.fn(async () => ({
				kind: 'ok' as const,
				value: { accounts: [SELF, owner, BERT], passwordMin: 8, households: [] }
			}))
		});
		expect(within(rowOf('Anna Beispiel')).getByText('Inhaber von „Haus“')).toBeTruthy();
		await choose('Anna Beispiel', 'Deaktivieren …');
		const dialog = screen.getByRole('dialog', { name: 'Anna Beispiel deaktivieren?' });
		expect(within(dialog).getByText(/Inhaber des Haushalts „Haus“/)).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Haushalte ohne aktiven Inhaber' })).toBeNull();
	});

	it('lets the administrator make an active member the owner after a question', async () => {
		const setHouseholdOwner = vi.fn(async () => ({
			kind: 'ok' as const,
			value: { accounts: [SELF, ANNA, BERT], passwordMin: 8, households: [] }
		}));
		const { flags } = await show({
			list: vi.fn(async () => ({
				kind: 'ok' as const,
				value: { accounts: [SELF, ANNA, OWNER], passwordMin: 8, households: [HOUSEHOLD] }
			})),
			setHouseholdOwner
		});
		const region = screen.getByRole('region', { name: 'Haushalte ohne aktiven Inhaber' });
		expect(within(region).getByText('Wohnung')).toBeTruthy();
		const select = within(region).getByLabelText('Neuer Inhaber') as HTMLSelectElement;
		// Only active members can become the owner.
		expect([...select.options].map((option) => option.textContent)).toEqual(['Anna Beispiel']);
		await fireEvent.click(within(region).getByRole('button', { name: 'Zum Inhaber machen …' }));
		const dialog = screen.getByRole('dialog', {
			name: 'Anna Beispiel zum Inhaber von „Wohnung“ machen?'
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zum Inhaber machen' }));
		await vi.waitFor(() =>
			expect(setHouseholdOwner).toHaveBeenCalledWith(
				'house000000001',
				'member00000002',
				expect.anything()
			)
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole('region', { name: 'Haushalte ohne aktiven Inhaber' })).toBeNull()
		);
		expect(flags.map((flag) => flag.title)).toContain(
			'Anna Beispiel ist jetzt Inhaber von „Wohnung“.'
		);
	});
});

describe('page "Konten": refusals', () => {
	it('says why there is no list for an account without the right', async () => {
		await show({
			list: vi.fn(async () => ({ kind: 'denied' as const, reason: 'owner' as const }))
		});
		expect(screen.getByText('Nur für den Verwalter der App')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Konto anlegen' })).toBeNull();
	});

	it('names the restart before the migration', async () => {
		await show({
			list: vi.fn(async () => ({ kind: 'denied' as const, reason: 'missing' as const }))
		});
		expect(screen.getByText('Nach dem nächsten Neustart verfügbar')).toBeTruthy();
	});
});
