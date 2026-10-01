// Settings "Tickets" (ADR-0037 §8): the retention of the trash as a group of radios, 30 days
// chosen by default, a choice saves at once for the account, the hint before the migration.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { TrashRetention } from '$lib/domain/trash';
import { TrashStore, type TrashData } from '$lib/stores/trash.svelte';
import TrashSettingsHarness from '$lib/test/TrashSettingsHarness.svelte';

async function showPage(overrides: Partial<TrashData> = {}) {
	// The server keeps the saved value and answers it with the next list.
	let saved: TrashRetention = '30';
	const data: TrashData = {
		list: vi.fn(async () => ({ items: [], retention: saved })),
		preview: vi.fn(),
		restore: vi.fn(),
		resolve: vi.fn(),
		purge: vi.fn(),
		purgeAll: vi.fn(),
		saveRetention: vi.fn(async (value) => (saved = value)),
		...overrides
	};
	const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() });
	await store.reload();
	render(TrashSettingsHarness, { props: { store } });
	await tick();
	return { store, data };
}

describe('settings "Tickets"', () => {
	it('offers 7, 30, 90 days and never, with 30 days as default', async () => {
		await showPage();
		const group = screen.getByRole('group', { name: 'Papierkorb' });
		const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((radio) => radio.value)).toEqual(['7', '30', '90', 'never']);
		expect(radios.find((radio) => radio.checked)?.value).toBe('30');
		expect(screen.getByRole('radio', { name: 'Nie automatisch' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Papierkorb' }).getAttribute('href')).toBe(
			'/papierkorb'
		);
		expect(screen.getByText(/nach 30 Tagen endgültig gelöscht/)).toBeTruthy();
	});

	it('saves a choice at once for the account', async () => {
		const { data, store } = await showPage();
		await fireEvent.click(screen.getByRole('radio', { name: '90 Tage' }));
		await vi.waitFor(() => expect(data.saveRetention).toHaveBeenCalledWith('90'));
		await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(2));
		expect(store.retention).toBe('90');
		expect((screen.getByRole('radio', { name: '90 Tage' }) as HTMLInputElement).checked).toBe(true);
	});

	it('says that the trash comes with the next start before the migration', async () => {
		await showPage({
			list: vi.fn(async () => Promise.reject(new DataError('server', { status: 503 })))
		});
		expect(screen.getByText(/nach dem nächsten Neustart verfügbar/)).toBeTruthy();
		expect(screen.queryByRole('radio')).toBeNull();
	});
});
