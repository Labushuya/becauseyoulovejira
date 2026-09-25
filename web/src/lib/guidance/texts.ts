// Shared texts of the guidance (ADR-0026 section 2, plan EH-2). One wording for the hint after an
// update whose migration runs only after a restart: while the app runs, start.bat only opens the
// browser, so the hint always names "stop.bat, dann start.bat". Pure module without runes.

/** Title and text of the section message "restart needed". */
export const RESTART_NEEDED = {
	title: 'Nach dem nächsten Neustart verfügbar',
	text: 'Die App hat ein Update bekommen, das erst nach einem Neustart wirkt: stop.bat, dann start.bat im Ordner app.'
} as const;

/**
 * The same hint as one sentence for places without a title (errors of a store, results of a
 * file): `subject` names the area with its verb, e.g. "Der Eingang ist" or "Die Verbindungen sind".
 */
export function restartNeeded(subject: string): string {
	return `${subject} nach dem nächsten Neustart verfügbar. ${RESTART_NEEDED.text}`;
}
