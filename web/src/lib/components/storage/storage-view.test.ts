// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9): the parts of the measurement (databases with
// groups and the trash, files of the inbox by where they belong, the largest entries with their
// ticket, backups, program and logs with the free space), the hint for a server outside the folder
// app, and the three actions with their preview and a question first (old automatic backups of
// PocketBase only when chosen). Real StorageStore on a fake data layer; jsdom has no showModal(),
// the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseOverview, type StorageOverview } from '$lib/domain/storage';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
import { StorageStore, type StorageData } from '$lib/stores/storage.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { storageAnswer } from '$lib/test/storage-answer';
import StorageView from './StorageView.svelte';

useOverlayStubs();

function overviewOf(overrides: Record<string, unknown> = {}): StorageOverview {
	const overview = parseOverview(storageAnswer(overrides));
	if (overview === null) throw new Error('test answer does not parse');
	return overview;
}

async function show(
	overview: StorageOverview | null = overviewOf(),
	overrides: Partial<StorageData> = {}
) {
	const data: StorageData = {
		overview: vi.fn(async () =>
			overview === null
				? { kind: 'denied' as const, reason: 'owner' as const }
				: { kind: 'ok' as const, value: overview }
		),
		act: vi.fn(async () => ({ kind: 'ok' as const, value: {} })),
		...overrides
	};
	const store = new StorageStore(data, { ensureValid: () => true, logout: vi.fn() }, SILENT_FLAGS);
	await store.load();
	render(StorageView, { props: { store, platform: 'windows' } });
	await tick();
	return { store, data };
}

function rowOf(label: string): HTMLElement {
	const term = screen.getByText(label, { selector: 'dt' });
	return term.parentElement as HTMLElement;
}

/** The text of an element with its white space folded, as it reads. */
function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ');
}

describe('page "Speicher"', () => {
	it('shows the databases with their groups and the trash with its blocked tickets', async () => {
		await show();
		expect(within(rowOf('Daten (data.db)')).getByText('50 MB, davon 6 MB frei')).toBeTruthy();
		expect(within(rowOf('Verlauf')).getByText('15 MB')).toBeTruthy();
		const trash = rowOf('Papierkorb');
		expect(trash.textContent).toMatch(/3 Tickets, etwa 4 KB Text, davon 1 blockiert\./);
		expect(
			within(trash).getByRole('link', { name: 'Papierkorb öffnen' }).getAttribute('href')
		).toBe('/papierkorb');
		expect(within(rowOf('Logs (auxiliary.db)')).getByText('2 MB')).toBeTruthy();
	});

	it('sorts the files of the inbox and lists the largest with their ticket', async () => {
		await show();
		expect(within(rowOf('An offenen Tickets')).getByText('1 Datei, 25 MB')).toBeTruthy();
		expect(text(rowOf('Verworfen'))).toMatch(/die App leert den nächsten ab 31\.10\.2026/);
		expect(within(rowOf('Davon Kopien aus „Duplizieren“')).getByText('1 Datei, 1 KB')).toBeTruthy();
		const largest = screen.getByRole('region', { name: 'Größte Einträge' });
		const link = within(largest).getByRole('link', { name: 'Rechnung' });
		expect(link.getAttribute('href')).toBe('/eingang/item00000000001');
		expect(within(largest).getByText('gehört zu HAUS-12 (offen)')).toBeTruthy();
		expect(
			screen.getByText(/Originaldateien an Quellen lassen sich nicht einzeln löschen/)
		).toBeTruthy();
	});

	it('shows backups, program, logs and the free space with a calm warning', async () => {
		await show();
		expect(rowOf('Hier (pb_data\\backups)').textContent).toMatch(/2 Sicherungen, 100 MB/);
		expect(within(rowOf('Im Zielverzeichnis')).getByText('Gerade nicht erreichbar')).toBeTruthy();
		expect(rowOf('Alte Sicherungen von PocketBase').textContent).toMatch(/1 Sicherung, 40 MB/);
		expect(within(rowOf('Reste nach Updates')).getByText('1 Datei, 95 MB')).toBeTruthy();
		expect(rowOf('Oberfläche (pb_public)').textContent).toMatch(
			/12 MB, Dateien der letzten 10 Builds/
		);
		const disk = rowOf('Freier Platz');
		expect(within(disk).getByText('Wird knapp')).toBeTruthy();
		expect(disk.querySelector('[data-tone="danger"]')).toBeNull();
		expect(screen.queryByText('Nur ein Teil des Speichers')).toBeNull();
		expect(screen.getByRole('link', { name: 'Einstellungen → Sicherung' })).toBeTruthy();
		expect(duplicateIds()).toEqual([]);
		expect(danglingReferences(screen.getByRole('region', { name: 'Aufräumen' }))).toEqual([]);
	});

	it('says what a server outside the folder app cannot show', async () => {
		const backups = storageAnswer().backups as Record<string, unknown>;
		await show(
			overviewOf({
				own_instance: false,
				logs: null,
				program: null,
				disk: null,
				backups: { ...backups, safety: null, target: null },
				actions: {
					leftovers: { programs: null, safety: null, pocketbase: { count: 0, bytes: 0 } },
					discarded: { count: 0, bytes: 0 }
				}
			})
		);
		expect(screen.getByRole('heading', { name: /Nur ein Teil des Speichers/ })).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Programm und Logs' })).toBeNull();
		expect(
			within(rowOf('Im Zielverzeichnis')).getByText('Kein Zielverzeichnis eingestellt')
		).toBeTruthy();
		const programs = screen.getByRole('checkbox', { name: /Programmreste nach Updates/ });
		expect((programs as HTMLInputElement).disabled).toBe(true);
		expect(
			screen
				.getByRole('button', { name: 'Verworfene jetzt leeren …' })
				.getAttribute('aria-disabled')
		).toBe('true');
	});

	it('shows a refusal with "Erneut messen"', async () => {
		const { data } = await show(null);
		expect(screen.getByText('Nur für den Verwalter der App')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut messen' }));
		expect(data.overview).toHaveBeenCalledTimes(2);
	});

	it('names the restart after an update while the route is missing', async () => {
		await show(null, {
			overview: vi.fn(async () => ({ kind: 'denied' as const, reason: 'missing' as const }))
		});
		expect(screen.getByText(RESTART_NEEDED.title)).toBeTruthy();
		expect(screen.getByText(restartNeeded('Die Seite Speicher ist'))).toBeTruthy();
	});
});

describe('actions of the page "Speicher"', () => {
	it('compacts the databases after a question that names the short wait', async () => {
		const { data } = await show();
		await fireEvent.click(screen.getByRole('button', { name: 'Datenbank verdichten …' }));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Datenbank verdichten?' });
		expect(within(dialog).getByText(/wartet jede andere Anfrage an die App kurz/)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Datenbank verdichten' }));
		await vi.waitFor(() => expect(data.act).toHaveBeenCalledWith('vacuum', [], expect.anything()));
		expect(data.overview).toHaveBeenCalledTimes(2);
	});

	it('clears leftovers, old backups of PocketBase only when chosen', async () => {
		const { data } = await show();
		const pocketbase = screen.getByRole('checkbox', {
			name: /Alte automatische Sicherungen von PocketBase/
		});
		expect((pocketbase as HTMLInputElement).checked).toBe(false);
		expect(screen.getByText('Betrifft 1 Eintrag, 95 MB.')).toBeTruthy();
		await fireEvent.click(pocketbase);
		expect(screen.getByText('Betrifft 2 Einträge, 135 MB.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Liegengebliebenes aufräumen …' }));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Liegengebliebenes aufräumen?' });
		expect(within(dialog).getByText(/Das lässt sich nicht rückgängig machen\./)).toBeTruthy();
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'Liegengebliebenes aufräumen' })
		);
		await vi.waitFor(() =>
			expect(data.act).toHaveBeenCalledWith(
				'leftovers',
				['programs', 'safety', 'pocketbase'],
				expect.anything()
			)
		);
	});

	it('empties discarded entries early and shows a refusal at the actions', async () => {
		const act = vi.fn(async () => ({ kind: 'denied' as const, reason: 'busy' as const }));
		await show(overviewOf(), { act });
		await fireEvent.click(screen.getByRole('button', { name: 'Verworfene jetzt leeren …' }));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Verworfene jetzt leeren?' });
		expect(within(dialog).getByText(/Betrifft 1 Eintrag, 2 KB\./)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verworfene jetzt leeren' }));
		await vi.waitFor(() => expect(screen.getByText('Es läuft schon eine Aktion')).toBeTruthy());
		expect(act).toHaveBeenCalledWith('discarded', [], expect.anything());
	});

	it('names the sources bound to tickets in the trash it leaves out, with the way to decide', async () => {
		await show();
		const actions = screen.getByRole('region', { name: 'Aufräumen' });
		expect(
			within(actions).getByText(
				/Nicht dabei: 1 Datei, 5 MB an Quellen von Tickets im Papierkorb\. Über sie entscheidest du dort unter „Abhängigkeiten auflösen“\./
			)
		).toBeTruthy();
		expect(
			within(actions).getByRole('link', { name: 'Im Papierkorb entscheiden' }).getAttribute('href')
		).toBe('/papierkorb');
	});

	it('says nothing about bound sources when no ticket in the trash keeps one', async () => {
		const files = storageAnswer().files as Record<string, unknown>;
		const categories = files.categories as Record<string, unknown>;
		await show(
			overviewOf({
				files: { ...files, categories: { ...categories, trash: { count: 0, bytes: 0 } } }
			})
		);
		expect(screen.queryByText(/Nicht dabei:/)).toBeNull();
		expect(screen.queryByRole('link', { name: 'Im Papierkorb entscheiden' })).toBeNull();
	});
});
