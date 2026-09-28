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

/** Flag in an open tab when start.bat or the landing page opened the app again (ADR-0035 §5). */
export const APP_OPENED_AGAIN = {
	title: 'Du hast becauseyoulovejira erneut geöffnet.',
	description: 'Die App ist hier schon offen.'
} as const;

/** Neutral flag in the open tabs when stop.bat ends the app (ADR-0035 §5); not an error. */
export const APP_STOPPED = {
	title: 'becauseyoulovejira wurde beendet (stop.bat).',
	description: 'Zum Weiterarbeiten start.bat ausführen.'
} as const;

/** Windows notification of a hidden tab (opt-in, ADR-0035 §5); a click brings the tab forward. */
export const APP_OPENED_NOTIFICATION = {
	title: 'becauseyoulovejira ist schon offen',
	body: 'Klicken, um dorthin zu wechseln.'
} as const;

/** Title a hidden tab alternates with while it asks for attention. */
export const ATTENTION_TITLE = '● Hier ist becauseyoulovejira';

/** Modal of a second tab of the same browser (ADR-0035 §6). */
export const DUPLICATE_TAB = {
	title: 'Die App ist schon offen',
	text: 'becauseyoulovejira ist in einem anderen Tab dieses Browsers geöffnet. Dort erscheint ein Hinweis.',
	closing: (seconds: number) => `Dieser Tab schließt sich in ${seconds} s.`,
	closeFailed: 'Du kannst diesen Tab jetzt schließen.',
	keep: 'Hier weiterarbeiten',
	close: 'Tab schließen'
} as const;
