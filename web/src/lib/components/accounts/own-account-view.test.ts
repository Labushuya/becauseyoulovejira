// The forms of "Einstellungen → Konto" (ADR-0056 §3): the display name (trimmed, errors at the
// field) and the own password (old one, new one twice, minimum of PocketBase, a wrong old password at
// its field), results as flags. Real OwnAccountStore on a fake data layer.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';
import { OwnAccountStore, type OwnAccountData } from '$lib/stores/own-account.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import OwnAccountView from './OwnAccountView.svelte';

function show(overrides: Partial<OwnAccountData> = {}, admin = false) {
	const data: OwnAccountData = {
		saveName: vi.fn(async (_id: string, name: string) => name),
		changePassword: vi.fn(async () => undefined),
		...overrides
	};
	const flags: FlagInput[] = [];
	const sink: FlagSink = {
		show: (input) => {
			flags.push(input);
			return 'flag';
		},
		dismiss: () => undefined
	};
	const store = new OwnAccountStore(
		data,
		{
			userId: 'user0000000001',
			email: 'anna@example.com',
			ensureValid: () => true,
			logout: vi.fn()
		},
		sink
	);
	render(OwnAccountView, {
		props: {
			store,
			email: 'anna@example.com',
			name: 'Anna',
			admin,
			accountsHref: '/einstellungen/konten'
		}
	});
	return { data, flags };
}

async function type(label: string, value: string) {
	await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('display name', () => {
	it('saves the name trimmed with a flag', async () => {
		const { data, flags } = show();
		await type('Name', '  Anna Beispiel ');
		await fireEvent.click(screen.getByRole('button', { name: 'Name speichern' }));
		await vi.waitFor(() =>
			expect(data.saveName).toHaveBeenCalledWith(
				'user0000000001',
				'Anna Beispiel',
				expect.anything()
			)
		);
		await vi.waitFor(() => expect(flags.map((flag) => flag.title)).toEqual(['Name gespeichert.']));
	});

	it('refuses an empty name at the field without sending', async () => {
		const { data } = show();
		await type('Name', '   ');
		await fireEvent.click(screen.getByRole('button', { name: 'Name speichern' }));
		expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Bitte einen Namen eingeben.')).toBeTruthy();
		expect(data.saveName).not.toHaveBeenCalled();
	});
});

describe('password', () => {
	it('checks the old one, the minimum and the repetition before sending', async () => {
		const { data } = show();
		await type('Neues Passwort', 'kurz');
		await type('Neues Passwort wiederholen', 'anders');
		await fireEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }));
		expect(screen.getByText('Bitte das bisherige Passwort eingeben.')).toBeTruthy();
		expect(screen.getByText('Mindestens 8 Zeichen.')).toBeTruthy();
		expect(screen.getByText('Die beiden neuen Passwörter sind verschieden.')).toBeTruthy();
		expect(screen.getByLabelText('Bisheriges Passwort').getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(screen.getByLabelText('Bisheriges Passwort'));
		expect(data.changePassword).not.toHaveBeenCalled();
		expect(danglingReferences(document.body)).toEqual([]);
		expect(duplicateIds(document.body)).toEqual([]);
	});

	it('changes the password, empties the fields and says so', async () => {
		const { data, flags } = show();
		await type('Bisheriges Passwort', 'altes-passwort');
		await type('Neues Passwort', 'neues-passwort-1');
		await type('Neues Passwort wiederholen', 'neues-passwort-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }));
		await vi.waitFor(() =>
			expect(data.changePassword).toHaveBeenCalledWith(
				{
					id: 'user0000000001',
					email: 'anna@example.com',
					current: 'altes-passwort',
					next: 'neues-passwort-1'
				},
				expect.anything()
			)
		);
		await vi.waitFor(() => expect(flags.map((flag) => flag.title)).toEqual(['Passwort geändert.']));
		expect((screen.getByLabelText('Bisheriges Passwort') as HTMLInputElement).value).toBe('');
		expect((screen.getByLabelText('Neues Passwort') as HTMLInputElement).value).toBe('');
	});

	it('names a wrong old password at its field', async () => {
		show({
			changePassword: vi.fn(async () => {
				throw new DataError('validation', {
					status: 400,
					fields: {
						oldPassword: { code: 'validation_invalid_old_password', message: 'Ungültige Eingabe.' }
					}
				});
			})
		});
		await type('Bisheriges Passwort', 'falsch-falsch');
		await type('Neues Passwort', 'neues-passwort-1');
		await type('Neues Passwort wiederholen', 'neues-passwort-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }));
		await vi.waitFor(() =>
			expect(screen.getByText('Das bisherige Passwort stimmt nicht.')).toBeTruthy()
		);
		expect(screen.getByLabelText('Bisheriges Passwort').getAttribute('aria-invalid')).toBe('true');
	});
});
