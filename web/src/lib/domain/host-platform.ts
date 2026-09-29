// Operating system of the server (ADR-0028, plan plattformen S0-3): the guides of the app name
// setx, start.bat and neu-starten.bat, which only fit a server on Windows. The server reports its system
// over GET /api/byl/host (lib/host-platform.js); on any other system the guides get a note above
// them. Pure module: no requests, no runes.

export const HOST_PLATFORMS = ['windows', 'linux', 'container'] as const;
export type HostPlatform = (typeof HOST_PLATFORMS)[number];

/** Windows is the reference platform: the guides are written for it. */
export const DEFAULT_HOST_PLATFORM: HostPlatform = 'windows';

/** The platform of an answer of the route; anything else counts as Windows. */
export function parseHostPlatform(answer: unknown): HostPlatform {
	if (typeof answer !== 'object' || answer === null) return DEFAULT_HOST_PLATFORM;
	const platform = (answer as { platform?: unknown }).platform;
	return (HOST_PLATFORMS as readonly unknown[]).includes(platform)
		? (platform as HostPlatform)
		: DEFAULT_HOST_PLATFORM;
}

export interface HostGuideNote {
	title: string;
	text: string;
}

const GUIDE_NOTES: Readonly<Record<Exclude<HostPlatform, 'windows'>, HostGuideNote>> = {
	linux: {
		title: 'Dein Server läuft unter Linux',
		text:
			'Die Anleitungen hier beschreiben einen Server unter Windows (setx, start.bat, neu-starten.bat). ' +
			'Unter Linux setzt du dieselben BYL_-Variablen in der Umgebung des PocketBase-Prozesses, ' +
			'etwa in der Umgebungsdatei seines Dienstes, und startest den Server danach neu.'
	},
	container: {
		title: 'Dein Server läuft in einem Container',
		text:
			'Die Anleitungen hier beschreiben einen Server unter Windows (setx, start.bat, neu-starten.bat). ' +
			'Im Container setzt du dieselben BYL_-Variablen in der Umgebungsdatei des Containers und ' +
			'erstellst ihn danach neu (docker compose up -d); ein bloßer Neustart liest die Datei nicht neu.'
	}
};

/** Note above the Windows guides, or null on Windows. */
export function hostGuideNote(platform: HostPlatform): HostGuideNote | null {
	return platform === 'windows' ? null : GUIDE_NOTES[platform];
}
