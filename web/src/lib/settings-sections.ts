// Pages of the settings area (ADR-0026 section 1, plan EH-1). A page is listed only once its
// package brings it, so the navigation never has a dead link: "Darstellung" and "Konto" follow
// with EH-8, "Hilfe" with EH-9. "Tags" moved here from the project view (user request after EH-4).

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
	{ id: 'tags', label: 'Tags', href: resolve('/einstellungen/tags') }
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
