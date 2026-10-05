// Pages of the settings area (ADR-0026 section 1, plan EH-1). A page is listed only once its
// package brings it, so the navigation never has a dead link: "Hilfe" came with EH-9, "Darstellung"
// and "Konto" with EH-8. "Tags" moved here from the project view (user request after EH-4). Since
// UI-1 (ADR-0060) the navigation shows the pages in groups with a heading; the addresses stayed.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { AdminPages } from '$lib/domain/context';
import type { HostPlatform } from '$lib/domain/host-platform';

/** Groups of the navigation, in their order (UI-1, ADR-0060). */
export type SettingsGroupId = 'arbeit' | 'persoenlich' | 'verwaltung' | 'hilfe';

export interface SettingsGroup {
	readonly id: SettingsGroupId;
	/** Heading of the group; null for the help at the end, which needs none. */
	readonly label: string | null;
}

/**
 * What the app brings in and how tickets are kept, then what belongs to the person (how the app
 * looks on this device, the household and the own account), then the administration of the app.
 * "Mein Konto" ends "Persönlich" and "Konten verwalten" starts "Verwaltung", so the own account and
 * the accounts of everybody stand next to each other, with names that keep them apart.
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
	{ id: 'arbeit', label: 'Eingang und Tickets' },
	{ id: 'persoenlich', label: 'Persönlich' },
	{ id: 'verwaltung', label: 'Verwaltung' },
	{ id: 'hilfe', label: null }
];

export interface SettingsSection {
	/** Last part of the address, e.g. "kanaele". */
	readonly id: string;
	readonly label: string;
	readonly href: ResolvedPathname;
	readonly group: SettingsGroupId;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{ id: 'kanaele', label: 'Kanäle', href: resolve('/einstellungen/kanaele'), group: 'arbeit' },
	{
		id: 'datei-importe',
		label: 'Datei-Importe',
		href: resolve('/einstellungen/datei-importe'),
		group: 'arbeit'
	},
	{ id: 'tags', label: 'Tags', href: resolve('/einstellungen/tags'), group: 'arbeit' },
	// Settings of the tickets, since ADR-0037 the retention of the trash.
	{ id: 'tickets', label: 'Tickets', href: resolve('/einstellungen/tickets'), group: 'arbeit' },
	{
		id: 'darstellung',
		label: 'Darstellung',
		href: resolve('/einstellungen/darstellung'),
		group: 'persoenlich'
	},
	// The household of the account (ADR-0058, E7-2): for every account, on every device.
	{
		id: 'haushalt',
		label: 'Haushalt',
		href: resolve('/einstellungen/haushalt'),
		group: 'persoenlich'
	},
	// The own account (ADR-0056 §3); "Mein", so it is not taken for the accounts of everybody.
	{ id: 'konto', label: 'Mein Konto', href: resolve('/einstellungen/konto'), group: 'persoenlich' },
	// The accounts of the app for its administrator (ADR-0056 §3), on every server.
	{
		id: 'konten',
		label: 'Konten verwalten',
		href: resolve('/einstellungen/konten'),
		group: 'verwaltung'
	},
	// How the app protects itself and what can be set (ADR-0055 §8), on every server; the further
	// hosts only for the folder app under Windows.
	{
		id: 'sicherheit',
		label: 'Sicherheit',
		href: resolve('/einstellungen/sicherheit'),
		group: 'verwaltung'
	},
	// Backups, target folder and passphrase (ADR-0046), only for a server on Windows.
	{
		id: 'sicherung',
		label: 'Sicherung',
		href: resolve('/einstellungen/sicherung'),
		group: 'verwaltung'
	},
	// What the app takes and what can be cleared (ADR-0047 §6), on every server; the parts of the
	// folder app under Windows only there.
	{
		id: 'speicher',
		label: 'Speicher',
		href: resolve('/einstellungen/speicher'),
		group: 'verwaltung'
	},
	// Operation of the app from the dashboard (ADR-0043), only for a server on Windows.
	{ id: 'system', label: 'System', href: resolve('/einstellungen/system'), group: 'verwaltung' },
	{ id: 'hilfe', label: 'Hilfe', href: resolve('/einstellungen/hilfe'), group: 'hilfe' }
];

/** A page below a page of the navigation; the navigation marks its parent. */
export interface SettingsSubpage {
	readonly id: string;
	readonly label: string;
	readonly href: ResolvedPathname;
	/** ID of the page it belongs to. */
	readonly parent: string;
}

export const SETTINGS_SUBPAGES: readonly SettingsSubpage[] = [
	// The form controls in all their states (UI-1, ADR-0060), linked quietly from the help.
	{
		id: 'elemente',
		label: 'Eingabeelemente',
		href: resolve('/einstellungen/hilfe/elemente'),
		parent: 'hilfe'
	}
];

/** Pages that drive the scripts of the folder app under Windows (ADR-0043, ADR-0046). */
const WINDOWS_ONLY = ['sicherung', 'system'];

/** Pages of the administrator of the app (ADR-0056 §7); the routes refuse every other account. */
export const ADMIN_ONLY: readonly string[] = [
	'konten',
	'sicherheit',
	'sicherung',
	'speicher',
	'system'
];

/** A page in the navigation; `pcOnly` marks a page of the administrator on another device. */
export interface VisibleSettingsSection extends SettingsSection {
	readonly pcOnly: boolean;
}

/** Whether `id` is a page of the administrator of the app. */
export function isAdminSection(id: string): boolean {
	return ADMIN_ONLY.includes(id);
}

/**
 * The pages the navigation lists for a server on `platform`: "Sicherung" and "System" drive the
 * scripts of the folder app under Windows, so they are left out for Linux and containers. The pages
 * of the administrator follow the context of the tab (KOB-1, ADR-0057): with data on the machine of
 * the app ("full"), marked "nur am PC" for the administrator on another device ("pc-only"), not at
 * all for every other account and while the context loads ("hidden", ADR-0056 §7).
 */
export function visibleSettingsSections(
	platform: HostPlatform,
	adminPages: AdminPages = 'full'
): readonly VisibleSettingsSection[] {
	return SETTINGS_SECTIONS.filter(
		(section) =>
			(platform === 'windows' || !WINDOWS_ONLY.includes(section.id)) &&
			(adminPages !== 'hidden' || !isAdminSection(section.id))
	).map((section) => ({
		...section,
		pcOnly: adminPages === 'pc-only' && isAdminSection(section.id)
	}));
}

/** A group of the navigation with its visible pages; `pcOnly` when all of them are "nur am PC". */
export interface SettingsNavGroup extends SettingsGroup {
	readonly sections: readonly VisibleSettingsSection[];
	readonly pcOnly: boolean;
}

/**
 * The visible pages in their groups, in the order of SETTINGS_GROUPS. A group without a visible
 * page is left out with its heading, so "Verwaltung" is not there at all for every other account
 * and while the context loads; for the administrator on another device the group as a whole is
 * "nur am PC" (KOB-1, ADR-0057).
 */
export function groupSettingsSections(
	sections: readonly VisibleSettingsSection[]
): readonly SettingsNavGroup[] {
	return SETTINGS_GROUPS.map((group) => {
		const own = sections.filter((section) => section.group === group.id);
		return { ...group, sections: own, pcOnly: own.length > 0 && own.every((s) => s.pcOnly) };
	}).filter((group) => group.sections.length > 0);
}

/** Start of the settings area; it forwards to the first page. */
export const SETTINGS_HOME = resolve('/einstellungen');

/** The page of `pathname`, or null outside the settings or for an unknown page. */
export function settingsSectionOf(pathname: string): SettingsSection | null {
	const normalized = pathname.replace(/\/+$/, '');
	return SETTINGS_SECTIONS.find((section) => section.href === normalized) ?? null;
}

/** The sub page of `pathname` (e.g. "Eingabeelemente" below "Hilfe"), or null. */
export function settingsSubpageOf(pathname: string): SettingsSubpage | null {
	const normalized = pathname.replace(/\/+$/, '');
	return SETTINGS_SUBPAGES.find((subpage) => subpage.href === normalized) ?? null;
}

/** The page with this ID, or null. */
export function settingsSectionById(id: string): SettingsSection | null {
	return SETTINGS_SECTIONS.find((section) => section.id === id) ?? null;
}

/** Whether `pathname` lies in the settings area (for aria-current of the gear in the header). */
export function isSettingsPath(pathname: string): boolean {
	return pathname === SETTINGS_HOME || pathname.startsWith(`${SETTINGS_HOME}/`);
}

/** Sections of the help page (EH-9), in their order, for the jump links and links from elsewhere. */
export const HELP_SECTIONS = [
	{ id: 'tastaturkuerzel', label: 'Tastaturkürzel' },
	{ id: 'kurzsyntax', label: 'Kurzsyntax' },
	// Plan "Wiederholungen verständlich machen": linked from the form, the overview and the rule.
	{ id: 'wiederholungen', label: 'Wiederholungen' },
	// The calendar (ADR-0053): views, layers, filters and keys.
	{ id: 'kalender', label: 'Kalender' },
	// The day plan (ADR-0065): kinds, sources, the shared plan of a household.
	{ id: 'tagesplan', label: 'Tagesplan' },
	{ id: 'zugangsdaten', label: 'Kanäle und Zugangsdaten' },
	// Own inbox (ADR-0038): linked from its card on "Kanäle".
	{ id: 'eigener-eingang', label: 'Eigener Eingang (API)' },
	// WhatsApp Web (ADR-0038 §4): linked from its card and its assistant.
	{ id: 'whatsapp-web', label: 'WhatsApp Web' },
	// Notion (ADR-0041): linked from its card and its import dialog.
	{ id: 'notion', label: 'Notion' },
	// GitHub (ADR-0050): linked from its card and its assistant.
	{ id: 'github', label: 'GitHub' },
	// Folders (ADR-0051): linked from their card.
	{ id: 'ordner', label: 'Ordner' },
	{ id: 'fragen', label: 'Häufige Fragen' },
	{ id: 'betrieb', label: 'Betrieb' },
	// Backups and the emergency plan (ADR-0046 §8): linked from the page "Sicherung".
	{ id: 'sicherung', label: 'Sicherung & Notfall' },
	// What the app takes and what can be cleared (ADR-0047 §6): linked from the page "Speicher".
	{ id: 'speicher', label: 'Speicher' },
	// The protection of the app (ADR-0055): linked from the page "Sicherheit".
	{ id: 'sicherheit', label: 'Sicherheit' },
	// Accounts and the administrator (ADR-0056): linked from "Mein Konto" and "Konten verwalten".
	{ id: 'konten', label: 'Konten und Verwalter' },
	// The household (ADR-0058): linked from the page "Haushalt".
	{ id: 'haushalt', label: 'Haushalt' },
	// The areas "Privat" and "Haushalt" (ADR-0059): linked from the catalog of the channels.
	{ id: 'bereiche', label: 'Bereiche Privat und Haushalt' }
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number]['id'];

/** Address of a section of the help page, e.g. "/einstellungen/hilfe#kurzsyntax". */
export function helpHref(section: HelpSection): ResolvedPathname {
	return `${resolve('/einstellungen/hilfe')}#${section}` as ResolvedPathname;
}

/** The protocol of failed sign-ins on the page "Sicherheit" (ADR-0055 §8). */
export function securityLoginsHref(): ResolvedPathname {
	return `${resolve('/einstellungen/sicherheit')}#anmeldungen` as ResolvedPathname;
}
