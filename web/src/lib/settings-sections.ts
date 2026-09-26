// Pages of the settings area (ADR-0026 section 1, plan EH-1). A page is listed only once its
// package brings it, so the navigation never has a dead link: "Hilfe" came with EH-9, "Darstellung"
// and "Konto" follow with EH-8 before it. "Tags" moved here from the project view (user request
// after EH-4).

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

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
	{ id: 'hilfe', label: 'Hilfe', href: resolve('/einstellungen/hilfe') }
];

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
	{ id: 'zugangsdaten', label: 'Kanäle und Zugangsdaten' },
	{ id: 'fragen', label: 'Häufige Fragen' },
	{ id: 'betrieb', label: 'Betrieb' }
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number]['id'];

/** Address of a section of the help page, e.g. "/einstellungen/hilfe#kurzsyntax". */
export function helpHref(section: HelpSection): ResolvedPathname {
	return `${resolve('/einstellungen/hilfe')}#${section}` as ResolvedPathname;
}
