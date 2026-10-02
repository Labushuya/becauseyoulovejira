// Pages of the settings area (ADR-0026 section 1, plan EH-1). A page is listed only once its
// package brings it, so the navigation never has a dead link: "Hilfe" came with EH-9, "Darstellung"
// and "Konto" with EH-8. "Tags" moved here from the project view (user request after EH-4).

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { HostPlatform } from '$lib/domain/host-platform';

export interface SettingsSection {
	/** Last part of the address, e.g. "kanaele". */
	readonly id: string;
	readonly label: string;
	readonly href: ResolvedPathname;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{ id: 'kanaele', label: 'Kanäle', href: resolve('/einstellungen/kanaele') },
	{ id: 'datei-importe', label: 'Datei-Importe', href: resolve('/einstellungen/datei-importe') },
	{ id: 'tags', label: 'Tags', href: resolve('/einstellungen/tags') },
	// Settings of the tickets, since ADR-0037 the retention of the trash.
	{ id: 'tickets', label: 'Tickets', href: resolve('/einstellungen/tickets') },
	{ id: 'darstellung', label: 'Darstellung', href: resolve('/einstellungen/darstellung') },
	{ id: 'konto', label: 'Konto', href: resolve('/einstellungen/konto') },
	// Backups, target folder and passphrase (ADR-0046), only for a server on Windows.
	{ id: 'sicherung', label: 'Sicherung', href: resolve('/einstellungen/sicherung') },
	// What the app takes and what can be cleared (ADR-0047 §6), on every server; the parts of the
	// folder app under Windows only there.
	{ id: 'speicher', label: 'Speicher', href: resolve('/einstellungen/speicher') },
	// Operation of the app from the dashboard (ADR-0043), only for a server on Windows.
	{ id: 'system', label: 'System', href: resolve('/einstellungen/system') },
	{ id: 'hilfe', label: 'Hilfe', href: resolve('/einstellungen/hilfe') }
];

/** Pages that drive the scripts of the folder app under Windows (ADR-0043, ADR-0046). */
const WINDOWS_ONLY = ['sicherung', 'system'];

/**
 * The pages the navigation lists for a server on `platform`: "Sicherung" and "System" drive the
 * scripts of the folder app under Windows, so they are left out for Linux and containers.
 */
export function visibleSettingsSections(platform: HostPlatform): readonly SettingsSection[] {
	return platform === 'windows'
		? SETTINGS_SECTIONS
		: SETTINGS_SECTIONS.filter((section) => !WINDOWS_ONLY.includes(section.id));
}

/** Start of the settings area; it forwards to the first page. */
export const SETTINGS_HOME = resolve('/einstellungen');

/** The page of `pathname`, or null outside the settings or for an unknown page. */
export function settingsSectionOf(pathname: string): SettingsSection | null {
	const normalized = pathname.replace(/\/+$/, '');
	return SETTINGS_SECTIONS.find((section) => section.href === normalized) ?? null;
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
	{ id: 'speicher', label: 'Speicher' }
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number]['id'];

/** Address of a section of the help page, e.g. "/einstellungen/hilfe#kurzsyntax". */
export function helpHref(section: HelpSection): ResolvedPathname {
	return `${resolve('/einstellungen/hilfe')}#${section}` as ResolvedPathname;
}
