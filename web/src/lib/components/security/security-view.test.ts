// Page "Einstellungen → Sicherheit" (ADR-0055 §8): the overview with a lozenge, a sentence and
// "Was bedeutet das?" per point, the level and the validity of a sign-in that apply when chosen, the
// further hosts with their checks at the field and the hint to restart, the protocol of failed
// sign-ins and the refusals. Real SecurityStore on a fake data layer.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseSecurity, type SecurityOverview } from '$lib/domain/security';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { securityLoginsHref } from '$lib/settings-sections';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { SecurityStore, type SecurityData } from '$lib/stores/security.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { securityAnswer } from '$lib/test/security-answer';
import SecurityView from './SecurityView.svelte';

function overviewOf(overrides: Record<string, unknown> = {}): SecurityOverview {
	const overview = parseSecurity(securityAnswer(overrides));
	if (overview === null) throw new Error('test answer does not parse');
	return overview;
}

async function show(
	overview: SecurityOverview | null = overviewOf(),
	overrides: Partial<SecurityData> = {}
) {
	const data: SecurityData = {
		overview: vi.fn(async () =>
			overview === null
				? { kind: 'denied' as const, reason: 'owner' as const }
				: { kind: 'ok' as const, value: overview }
		),
		settings: vi.fn(async (settings: { level?: string; days?: number }) => ({
			kind: 'ok' as const,
			value: {
				...(overview ?? overviewOf()),
				...(settings.level ? { level: settings.level as SecurityOverview['level'] } : {}),
				...(settings.days
					? { session: { ...(overview ?? overviewOf()).session, days: settings.days } }
					: {})
			}
		})),
		hosts: vi.fn(async (hosts: readonly string[]) => ({
			kind: 'ok' as const,
			value: {
				...(overview ?? overviewOf()),
				hosts: { ...(overview ?? overviewOf()).hosts, configured: hosts }
			}
		})),
		...overrides
	};
	const flags = { show: vi.fn((input: FlagInput) => `flag-${input.title}`), dismiss: vi.fn() };
	const store = new SecurityStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	await store.load();
	render(SecurityView, { props: { store } });
	await tick();
	return { store, data, flags };
}

describe('page "Sicherheit"', () => {
	it('shows every point with its state, a sentence and what it means, without red', async () => {
		await show();
		const overview = screen.getByRole('region', { name: 'Überblick' });
		const items = within(overview).getAllByRole('listitem');
		expect(items).toHaveLength(8);
		expect(within(items[0]!).getByText('Schutz vor Rateversuchen')).toBeTruthy();
		expect(within(items[0]!).getByText('Aktiv (Normal)')).toBeTruthy();
		expect(within(items[4]!).getByText('Verschlüsselt')).toBeTruthy();
		const meaning = within(items[0]!).getByText('Was bedeutet das?', { exact: false });
		expect(meaning.closest('summary')).not.toBeNull();
		expect(within(items[0]!).getByText(/\(Schutz vor Rateversuchen\)/).className).toContain(
			'visually-hidden'
		);
		expect(document.body.querySelector('[data-tone="danger"]')).toBeNull();
		expect(
			screen.getByRole('link', { name: 'Hilfe unter „Sicherheit“' }).getAttribute('href')
		).toBe('/einstellungen/hilfe#sicherheit');
		expect(duplicateIds()).toEqual([]);
		expect(danglingReferences(document.body)).toEqual([]);
	});

	it('sets the level when chosen and confirms it with a flag', async () => {
		const { data, flags } = await show();
		const strict = screen.getByRole('radio', { name: 'Streng' });
		expect((screen.getByRole('radio', { name: 'Normal' }) as HTMLInputElement).checked).toBe(true);
		expect(strict.getAttribute('aria-describedby')).toBeTruthy();
		await fireEvent.click(strict);
		await vi.waitFor(() =>
			expect(data.settings).toHaveBeenCalledWith({ level: 'strict' }, expect.anything())
		);
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'success', title: 'Schutz vor Rateversuchen: Streng' })
		);
		await tick();
		expect((screen.getByRole('radio', { name: 'Streng' }) as HTMLInputElement).checked).toBe(true);
	});

	it('says that a choice replaces rules of the admin UI', async () => {
		await show(overviewOf({ level: 'custom' }));
		expect(screen.getByText(/eine Wahl hier ersetzt sie/)).toBeTruthy();
		expect(screen.getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(
			false
		);
	});

	it('sets the validity of a sign-in from a short choice', async () => {
		const { data, flags } = await show();
		const select = screen.getByRole('combobox', {
			name: 'Gültigkeit der Anmeldung'
		}) as HTMLSelectElement;
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'1 Tag',
			'5 Tage (Standard)',
			'14 Tage',
			'30 Tage'
		]);
		expect(select.value).toBe('5');
		await fireEvent.change(select, { target: { value: '14' } });
		await vi.waitFor(() =>
			expect(data.settings).toHaveBeenCalledWith({ days: 14 }, expect.anything())
		);
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Anmeldung gilt 14 Tage' })
		);
	});

	it('shows a duration of the admin UI as its own entry', async () => {
		await show(
			overviewOf({ session: { days: null, seconds: 7200, choices: [1, 5, 14, 30], standard: 5 } })
		);
		const select = screen.getByRole('combobox', {
			name: 'Gültigkeit der Anmeldung'
		}) as HTMLSelectElement;
		expect(select.value).toBe('custom');
		expect(select.options[0]?.textContent).toBe('Eigene Einstellung: 2 Stunden');
	});

	it('checks a further host at the field, keeps the list until it is saved, then names the restart', async () => {
		const { data } = await show();
		expect(
			screen.getByRole('heading', { name: /Nur für einen späteren Zugriff von anderen Geräten/ })
		).toBeTruthy();
		const field = screen.getByRole('textbox', { name: 'Adresse hinzufügen' });
		await fireEvent.input(field, { target: { value: 'localhost' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
		expect(field.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText(/^Nur ein Name mit Punkt/)).toBeTruthy();
		expect(document.activeElement).toBe(field);

		await fireEvent.input(field, { target: { value: 'Rechner.Tailnet.ts.net' } });
		expect(field.getAttribute('aria-invalid')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
		const list = screen.getByRole('list', { name: 'Zusätzliche Adressen' });
		expect(within(list).getByText('rechner.tailnet.ts.net')).toBeTruthy();
		expect(screen.queryByText('Neustart nötig')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Adressen speichern' }));
		await vi.waitFor(() =>
			expect(data.hosts).toHaveBeenCalledWith(['rechner.tailnet.ts.net'], expect.anything())
		);
		await tick();
		expect(screen.getByText('Neustart nötig')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Zur Seite System' }).getAttribute('href')).toBe(
			'/einstellungen/system'
		);

		await fireEvent.click(
			screen.getByRole('button', { name: '„rechner.tailnet.ts.net“ entfernen' })
		);
		expect(screen.queryByRole('list', { name: 'Zusätzliche Adressen' })).toBeNull();
		expect(
			screen.getByRole('button', { name: 'Adressen speichern' }).getAttribute('aria-disabled')
		).toBeNull();
	});

	it('names the refused entries of the server', async () => {
		await show(overviewOf(), {
			hosts: vi.fn(async () => ({
				kind: 'invalid' as const,
				problem: 'invalid',
				invalid: ['x.local:99999']
			}))
		});
		const field = screen.getByRole('textbox', { name: 'Adresse hinzufügen' });
		await fireEvent.input(field, { target: { value: 'pi.example.org' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Adressen speichern' }));
		expect(await screen.findByText(/Abgelehnt: x\.local:99999\./)).toBeTruthy();
	});

	it('leaves the hosts to byl-config.json where the app cannot change them', async () => {
		const hosts = {
			own: ['127.0.0.1:8090', 'localhost:8090'],
			active: [],
			configured: [],
			editable: false,
			max: 10
		};
		await show(overviewOf({ hosts }));
		expect(screen.queryByRole('textbox', { name: 'Adresse hinzufügen' })).toBeNull();
		expect(screen.getByText(/Zusätzliche Adressen stellt nur die App unter Windows/)).toBeTruthy();
	});

	it('lists the failed sign-ins without a password, or says there are none', async () => {
		await show();
		const protocol = screen.getByRole('region', { name: 'Fehlgeschlagene Anmeldungen' });
		// The flag of ADR-0035 opens exactly this section.
		expect(securityLoginsHref()).toBe(`/einstellungen/sicherheit#${protocol.id}`);
		expect(
			within(protocol).getByText(
				/4 Versuche in den letzten 30 Tagen, davon 3 in den letzten 24 Stunden/
			)
		).toBeTruthy();
		expect(within(protocol).getByText(/^anna@example\.com · App-Konto/)).toBeTruthy();
		expect(within(protocol).getByText(/nie ein Passwort/)).toBeTruthy();
	});

	it('says when nothing failed and when the protocol starts', async () => {
		await show(overviewOf({ logins: { days: 30, total: 0, lastDay: 0, groups: [] } }));
		expect(
			screen.getByRole('heading', { name: 'Keine fehlgeschlagenen Anmeldungen' })
		).toBeTruthy();
		cleanup();
		await show(overviewOf({ logins: null }));
		expect(screen.getByText(RESTART_NEEDED.title)).toBeTruthy();
		expect(
			screen.getByText(restartNeeded('Das Protokoll fehlgeschlagener Anmeldungen ist'))
		).toBeTruthy();
	});

	it('shows a refusal with "Erneut laden"', async () => {
		const { data } = await show(null);
		expect(screen.getByText('Nur für das erste Konto')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
		expect(data.overview).toHaveBeenCalledTimes(2);
	});

	it('names the restart after an update while the route is missing', async () => {
		await show(null, {
			overview: vi.fn(async () => ({ kind: 'denied' as const, reason: 'missing' as const }))
		});
		expect(screen.getByText(RESTART_NEEDED.title)).toBeTruthy();
		expect(screen.getByText(restartNeeded('Die Seite Sicherheit ist'))).toBeTruthy();
	});
});
