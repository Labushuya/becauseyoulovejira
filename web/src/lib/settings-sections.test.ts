// The pages of the settings and their groups (UI-1, ADR-0060): every page in one group, the groups
// in one block each, "Verwaltung" exactly the pages of the administrator of KOB-1 (ADR-0057), the
// addresses unchanged, and the overview of the form controls as a sub page of "Hilfe".

import { describe, expect, it } from 'vitest';
import {
	ADMIN_ONLY,
	SETTINGS_GROUPS,
	SETTINGS_SECTIONS,
	groupSettingsSections,
	settingsSectionById,
	settingsSectionOf,
	settingsSubpageOf,
	visibleSettingsSections
} from './settings-sections';

describe('groups of the settings (UI-1)', () => {
	it('keeps every address of before', () => {
		expect(SETTINGS_SECTIONS.map((section) => section.href).sort()).toEqual(
			[
				'/einstellungen/darstellung',
				'/einstellungen/datei-importe',
				'/einstellungen/haushalt',
				'/einstellungen/hilfe',
				'/einstellungen/kanaele',
				'/einstellungen/konten',
				'/einstellungen/konto',
				'/einstellungen/sicherheit',
				'/einstellungen/sicherung',
				'/einstellungen/speicher',
				'/einstellungen/system',
				'/einstellungen/tags',
				'/einstellungen/tickets'
			].sort()
		);
	});

	it('puts every page in a known group and each group in one block, in the order of the groups', () => {
		const order = SETTINGS_GROUPS.map((group) => group.id);
		const seen = SETTINGS_SECTIONS.map((section) => section.group);
		expect(seen.every((group) => order.includes(group))).toBe(true);
		const blocks = seen.filter((group, index) => index === 0 || seen[index - 1] !== group);
		expect(blocks).toEqual(order);
	});

	it('makes "Verwaltung" exactly the pages of the administrator (KOB-1)', () => {
		const admin = SETTINGS_SECTIONS.filter((section) => section.group === 'verwaltung');
		expect(admin.map((section) => section.id)).toEqual([...ADMIN_ONLY]);
	});

	it('names the own account and the accounts of everybody apart, next to each other', () => {
		const ids = SETTINGS_SECTIONS.map((section) => section.id);
		expect(settingsSectionById('konto')?.label).toBe('Mein Konto');
		expect(settingsSectionById('konten')?.label).toBe('Konten verwalten');
		expect(ids.indexOf('konten') - ids.indexOf('konto')).toBe(1);
		expect(SETTINGS_GROUPS.find((group) => group.id === 'hilfe')?.label).toBeNull();
	});

	it.each([
		[
			'full',
			['Eingang und Tickets', 'Persönlich', 'Verwaltung', null],
			[false, false, false, false]
		],
		[
			'pc-only',
			['Eingang und Tickets', 'Persönlich', 'Verwaltung', null],
			[false, false, true, false]
		],
		['hidden', ['Eingang und Tickets', 'Persönlich', null], [false, false, false]]
	] as const)('groups the pages for the admin pages "%s"', (adminPages, labels, pcOnly) => {
		const groups = groupSettingsSections(visibleSettingsSections('windows', adminPages));
		expect(groups.map((group) => group.label)).toEqual(labels);
		expect(groups.map((group) => group.pcOnly)).toEqual(pcOnly);
		expect(groups.flatMap((group) => group.sections)).toEqual(
			visibleSettingsSections('windows', adminPages)
		);
	});

	it('finds the overview of the form controls as a sub page of "Hilfe", not as a page', () => {
		expect(settingsSubpageOf('/einstellungen/hilfe/elemente/')).toEqual(
			expect.objectContaining({ label: 'Eingabeelemente', parent: 'hilfe' })
		);
		expect(settingsSectionOf('/einstellungen/hilfe/elemente')).toBeNull();
		expect(settingsSubpageOf('/einstellungen/hilfe')).toBeNull();
		expect(settingsSectionById('gibt-es-nicht')).toBeNull();
	});
});
